const { Events } = require('discord.js');
const { ensureGuildSettings } = require('../services/guild');
const { handleButton } = require('../handlers/buttons');
const { assertCommandAccess } = require('../services/permissions');

function isGone(err) {
  return err?.code === 10062 || /Unknown interaction/i.test(err?.message || '');
}

function shimReply(interaction) {
  const origReply = interaction.reply.bind(interaction);
  const origDefer = interaction.deferReply.bind(interaction);
  interaction.deferReply = options => {
    if (interaction.deferred || interaction.replied) return Promise.resolve(null);
    return origDefer(options);
  };
  interaction.reply = options => {
    if (interaction.deferred && !interaction.replied) {
      const payload = typeof options === 'string' ? { content: options } : { ...options };
      delete payload.fetchReply;
      return interaction.editReply(payload);
    }
    return origReply(options);
  };
}

function publicize(interaction) {
  const origEdit = interaction.editReply.bind(interaction);
  let cleared = false;
  interaction.editReply = async options => {
    const payload = typeof options === 'string' ? { content: options } : { ...options };
    const keepPrivate = payload.flags === 64 || payload.ephemeral;
    delete payload.flags;
    delete payload.ephemeral;
    delete payload.fetchReply;
    if (keepPrivate) return origEdit(payload);
    if (!cleared) {
      cleared = true;
      await origEdit({ content: 'Posted in channel.' }).catch(() => {});
    }
    try {
      const msg = await interaction.followUp(payload);
      if (msg && !msg.channelId && interaction.channelId) msg.channelId = interaction.channelId;
      return msg;
    } catch (err) {
      console.warn(`public followUp failed: ${err.message}`);
      await origEdit({
        content: `Could not post publicly: ${String(err.message || err).slice(0, 400)}`,
      }).catch(() => {});
      return {
        id: null,
        channelId: interaction.channelId,
        channel: interaction.channel,
      };
    }
  };
}

function logFail(label, err) {
  if (isGone(err)) {
    console.warn(`${label}: Discord already used this click. If start.bat is open while Render is running, close the local window.`);
    return;
  }
  console.error(`${label} failed:`, err);
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      try {
        if (command?.autocomplete) await command.autocomplete(interaction);
        else await interaction.respond([]);
      } catch (err) {
        console.error(`Autocomplete ${interaction.commandName} failed:`, err.message);
        await interaction.respond([]).catch(() => {});
      }
      return;
    }

    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      const t0 = Date.now();
      const sub = interaction.options.getSubcommand(false);
      const label = sub ? `/${interaction.commandName} ${sub}` : `/${interaction.commandName}`;

      try {
        const isPublic = Boolean(command.publicCommand || (sub && command.publicSubs?.includes(sub)));
        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferReply({ flags: 64 });
        }
        shimReply(interaction);
        if (!(await assertCommandAccess(interaction, command))) {
          console.log(`cmd ${label} denied ${Date.now() - t0}ms`);
          return;
        }
        if (isPublic) publicize(interaction);
        if (interaction.guildId) await ensureGuildSettings(interaction.guildId);
        await command.execute(interaction);
        console.log(`cmd ${label} ok ${Date.now() - t0}ms deferred=${interaction.deferred}`);
      } catch (err) {
        console.warn(`cmd ${label} fail ${Date.now() - t0}ms code=${err.code || ''} ${err.message}`);
        logFail(`Command ${interaction.commandName}`, err);
        if (isGone(err)) return;
        await require('../services/commandFail').commandFail(interaction, err);
      }
      return;
    }

    if (interaction.isMessageContextMenuCommand()) {
      try {
        if (interaction.guildId) await ensureGuildSettings(interaction.guildId);
        if (interaction.commandName === 'Import as bingo list') {
          const command = require('../commands/bingo');
          await command.executeContext(interaction);
        }
      } catch (err) {
        logFail('Context menu', err);
        if (isGone(err)) return;
        if (!interaction.replied) await interaction.reply({ content: 'Could not import that message.', flags: 64 }).catch(() => {});
      }
      return;
    }

    const bingoUi = require('../services/bingoUi');
    if (interaction.isModalSubmit() && interaction.customId === 'event_create_modal') {
      try {
        await require('../services/eventRun').handleCreateModal(interaction);
      } catch (err) {
        logFail('Event modal', err);
        if (isGone(err)) return;
        await require('../services/commandFail').commandFail(interaction, err);
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('bg:')) {
      try {
        await bingoUi.handleBingoModal(interaction);
      } catch (err) {
        logFail('Bingo modal', err);
        if (isGone(err)) return;
        if (!interaction.replied) await interaction.reply({ content: 'Could not save that.', flags: 64 }).catch(() => {});
      }
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('bg:')) {
      try {
        if (interaction.guildId) ensureGuildSettings(interaction.guildId).catch(() => {});
        await bingoUi.handleBingoComponent(interaction);
      } catch (err) {
        logFail('Bingo select', err);
        if (isGone(err)) return;
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Could not do that.', flags: 64 }).catch(() => {});
        }
      }
      return;
    }

    if (interaction.isButton()) {
      try {
        // Bingo draft buttons often open a Modal — that must be the first reply.
        // Do not hit Postgres first or Discord expires the click.
        if (interaction.customId.startsWith('bg:')) {
          if (interaction.guildId) ensureGuildSettings(interaction.guildId).catch(() => {});
          await bingoUi.handleBingoComponent(interaction);
          return;
        }
        if (interaction.customId.startsWith('event_create:')) {
          await handleButton(interaction);
          return;
        }
        if (interaction.guildId) await ensureGuildSettings(interaction.guildId);
        await handleButton(interaction);
      } catch (err) {
        logFail(`Button ${interaction.customId}`, err);
        if (isGone(err)) return;
        await require('../services/commandFail').commandFail(interaction, err);
      }
    }
  },
};
