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
      delete payload.flags;
      delete payload.ephemeral;
      delete payload.fetchReply;
      return interaction.editReply(payload);
    }
    return origReply(options);
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

      try {
        const sub = interaction.options.getSubcommand(false);
        const isPublic = Boolean(command.publicCommand || (sub && command.publicSubs?.includes(sub)));
        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferReply(isPublic ? {} : { flags: 64 });
        }
        shimReply(interaction);
        if (!(await assertCommandAccess(interaction, command))) return;
        if (interaction.guildId) await ensureGuildSettings(interaction.guildId);
        await command.execute(interaction);
      } catch (err) {
        logFail(`Command ${interaction.commandName}`, err);
        if (isGone(err)) return;
        const msg = { content: 'Something went wrong running that command.', flags: 64 };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(msg).catch(() => {});
        } else {
          await interaction.reply(msg).catch(() => {});
        }
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
        if (interaction.guildId) await ensureGuildSettings(interaction.guildId);
        await handleButton(interaction);
      } catch (err) {
        logFail(`Button ${interaction.customId}`, err);
        if (isGone(err)) return;
        const msg = { content: 'Something went wrong with that button.', flags: 64 };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(msg).catch(() => {});
        } else {
          await interaction.reply(msg).catch(() => {});
        }
      }
    }
  },
};
