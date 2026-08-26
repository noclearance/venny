const { SlashCommandBuilder } = require('discord.js');
const { audit } = require('../services/audit');
const { commandFail } = require('../services/commandFail');
const mod = require('../services/moderation');

function note(reason) {
  return reason ? `Reason: ${reason}` : 'No reason given.';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mod')
    .setDescription('Kick, timeout, ban, or purge — not for masses')
    .setDefaultMemberPermissions(mod.SEE_MOD)
    .addSubcommand(sub =>
      sub.setName('timeout')
        .setDescription('Mute with a Discord timeout')
        .addUserOption(opt => opt.setName('user').setDescription('Who').setRequired(true))
        .addStringOption(opt =>
          opt.setName('how_long')
            .setDescription('How long they stay muted')
            .setRequired(true)
            .addChoices(
              { name: '5 minutes', value: '5m' },
              { name: '15 minutes', value: '15m' },
              { name: '1 hour', value: '1h' },
              { name: '6 hours', value: '6h' },
              { name: '1 day', value: '1d' },
              { name: '7 days', value: '7d' },
              { name: '28 days (max)', value: '28d' },
            ))
        .addStringOption(opt => opt.setName('reason').setDescription('Why').setMaxLength(400)))
    .addSubcommand(sub =>
      sub.setName('untimeout')
        .setDescription('Clear a timeout')
        .addUserOption(opt => opt.setName('user').setDescription('Who').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('kick')
        .setDescription('Kick from the server')
        .addUserOption(opt => opt.setName('user').setDescription('Who').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Why').setMaxLength(400)))
    .addSubcommand(sub =>
      sub.setName('ban')
        .setDescription('Ban from the server')
        .addUserOption(opt => opt.setName('user').setDescription('Who').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Why').setMaxLength(400))
        .addIntegerOption(opt =>
          opt.setName('delete_days')
            .setDescription('Delete their messages from the last N days (0–7)')
            .setMinValue(0)
            .setMaxValue(7)))
    .addSubcommand(sub =>
      sub.setName('unban')
        .setDescription('Unban by Discord user id')
        .addStringOption(opt =>
          opt.setName('user_id')
            .setDescription('The snowflake id (they are not in the server)')
            .setRequired(true)
            .setMaxLength(32)))
    .addSubcommand(sub =>
      sub.setName('purge')
        .setDescription('Delete recent messages in this channel')
        .addIntegerOption(opt =>
          opt.setName('count')
            .setDescription('How many (1–100)')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(100))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const actor = interaction.member;
    const me = interaction.guild.members.me;
    const reason = mod.clipReason(interaction.options.getString('reason'));
    const auditReason = reason || `by ${interaction.user.tag}`;

    try {
      mod.assertHasPerm(actor, sub);
    } catch (err) {
      return commandFail(interaction, err);
    }

    if (sub === 'purge') {
      const count = interaction.options.getInteger('count');
      if (!interaction.channel || !interaction.channel.bulkDelete) {
        return commandFail(interaction, 'I can only purge in a normal text channel.');
      }
      let deleted;
      try {
        deleted = await interaction.channel.bulkDelete(count, true);
      } catch (err) {
        return commandFail(interaction, mod.discordWhy(err));
      }
      const n = deleted.size;
      await interaction.editReply({ content: `Deleted **${n}** message${n === 1 ? '' : 's'} in ${interaction.channel}. Messages older than 14 days stay.` });
      await audit(interaction.client, interaction.guildId, `<@${interaction.user.id}> purged **${n}** in <#${interaction.channel.id}>`);
      return;
    }

    if (sub === 'unban') {
      const id = mod.snowflake(interaction.options.getString('user_id'));
      if (!id) return commandFail(interaction, 'That is not a Discord user id.');
      try {
        await interaction.guild.bans.remove(id, auditReason);
      } catch (err) {
        if (err?.code === 10026) return commandFail(interaction, 'That id is not banned.');
        return commandFail(interaction, mod.discordWhy(err));
      }
      await interaction.editReply({ content: `Unbanned \`${id}\`.` });
      await audit(interaction.client, interaction.guildId, `<@${interaction.user.id}> unbanned \`${id}\``);
      return;
    }

    const user = interaction.options.getUser('user');
    const target = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (sub === 'ban' && !target) {
      try {
        await interaction.guild.members.ban(user.id, {
          deleteMessageSeconds: (interaction.options.getInteger('delete_days') || 0) * 86400,
          reason: auditReason,
        });
      } catch (err) {
        return commandFail(interaction, mod.discordWhy(err));
      }
      await interaction.editReply({ content: `Banned **${user.tag}**. ${note(reason)}` });
      await audit(interaction.client, interaction.guildId, `<@${interaction.user.id}> banned ${user.tag} (${user.id}). ${note(reason)}`);
      return;
    }

    try {
      mod.assertCanAct(actor, target, me);
    } catch (err) {
      return commandFail(interaction, err);
    }

    try {
      if (sub === 'timeout') {
        const key = interaction.options.getString('how_long');
        const ms = mod.DURATIONS[key];
        if (!ms) return commandFail(interaction, 'Pick a duration from the list.');
        await mod.tell(user, `Timed out in **${interaction.guild.name}** for ${key}. ${note(reason)}`);
        await target.timeout(ms, auditReason);
        await interaction.editReply({ content: `Timed out <@${user.id}> for **${key}**. ${note(reason)}` });
        await audit(interaction.client, interaction.guildId, `<@${interaction.user.id}> timed out <@${user.id}> for ${key}. ${note(reason)}`);
        return;
      }
      if (sub === 'untimeout') {
        await target.timeout(null, auditReason);
        await interaction.editReply({ content: `Timeout cleared for <@${user.id}>.` });
        await audit(interaction.client, interaction.guildId, `<@${interaction.user.id}> cleared timeout on <@${user.id}>`);
        return;
      }
      if (sub === 'kick') {
        await mod.tell(user, `Kicked from **${interaction.guild.name}**. ${note(reason)}`);
        await target.kick(auditReason);
        await interaction.editReply({ content: `Kicked <@${user.id}>. ${note(reason)}` });
        await audit(interaction.client, interaction.guildId, `<@${interaction.user.id}> kicked <@${user.id}>. ${note(reason)}`);
        return;
      }
      if (sub === 'ban') {
        const days = interaction.options.getInteger('delete_days') || 0;
        await mod.tell(user, `Banned from **${interaction.guild.name}**. ${note(reason)}`);
        await target.ban({ deleteMessageSeconds: days * 86400, reason: auditReason });
        await interaction.editReply({ content: `Banned <@${user.id}>. ${note(reason)}` });
        await audit(interaction.client, interaction.guildId, `<@${interaction.user.id}> banned <@${user.id}>. ${note(reason)}`);
        return;
      }
    } catch (err) {
      return commandFail(interaction, mod.discordWhy(err));
    }

    return commandFail(interaction, `Unknown /mod option **${sub}**.`);
  },
};
