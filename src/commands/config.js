const { SlashCommandBuilder } = require('discord.js');
const { getDb } = require('../db/database');
const { isAdmin, ADMIN_PERMISSION } = require('../services/permissions');
const { isValidTimezone } = require('../services/timezone');
const { audit } = require('../services/audit');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure bot settings for this server')
    .setDefaultMemberPermissions(ADMIN_PERMISSION)
    .addSubcommand(sub =>
      sub.setName('wom-group')
        .setDescription('Set the Wise Old Man group ID for your clan')
        .addIntegerOption(opt => opt.setName('group_id').setDescription('WOM group ID (find it in the URL at wiseoldman.net/groups)').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('wom-verification')
        .setDescription('Set the WOM verification code (needed for auto-creating SOTW competitions)')
        .addStringOption(opt => opt.setName('code').setDescription('Verification code from WOM group settings').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('reminder-channel')
        .setDescription('Set the default channel for event reminders')
        .addChannelOption(opt => opt.setName('channel').setDescription('Channel for reminders').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('audit-channel')
        .setDescription('Set the channel for action logs (event cancel, raffle draw, SOTW end)')
        .addChannelOption(opt => opt.setName('channel').setDescription('Channel for audit logs').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('timezone')
        .setDescription('Set the server timezone for event scheduling')
        .addStringOption(opt => opt.setName('timezone').setDescription('IANA timezone, e.g. America/New_York, Europe/London, UTC').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('event-role')
        .setDescription('Set a Discord role to ping for an event category')
        .addStringOption(opt => opt.setName('category').setDescription('Event category').setRequired(true).addChoices(
          { name: 'General', value: 'general' },
          { name: 'Boss Masses', value: 'boss' },
          { name: 'PvM', value: 'pvm' },
          { name: 'Skilling', value: 'skilling' },
          { name: 'Social', value: 'social' },
        ))
        .addRoleOption(opt => opt.setName('role').setDescription('Role to ping').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('announce-channel')
        .setDescription('Channel for 99s, goals, bingo stamps, and BOTW noise')
        .addChannelOption(opt => opt.setName('channel').setDescription('Announce channel').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription('View current configuration')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const db = getDb();

    if (sub !== 'view' && !isAdmin(interaction.member)) {
      return interaction.reply({ content: '❌ You need Administrator permission to change bot settings.', flags: 64 });
    }

    if (sub === 'wom-group') {
      const groupId = interaction.options.getInteger('group_id');
      db.prepare('UPDATE guild_settings SET wom_group_id = ? WHERE guild_id = ?').run(groupId, interaction.guildId);
      await interaction.reply(`✅ WOM group ID set to **${groupId}**. Verify at https://wiseoldman.net/groups/${groupId}`);
      await audit(interaction.client, interaction.guildId, `WOM group ID set to ${groupId} by <@${interaction.user.id}>`);
      return;
    }

    if (sub === 'wom-verification') {
      const code = interaction.options.getString('code');
      db.prepare('UPDATE guild_settings SET wom_verif_code = ? WHERE guild_id = ?').run(code, interaction.guildId);
      await interaction.reply({ content: '✅ WOM verification code saved. SOTW competitions can now be auto-created on WOM.', flags: 64 });
      await audit(interaction.client, interaction.guildId, `WOM verification code updated by <@${interaction.user.id}>`);
      return;
    }

    if (sub === 'reminder-channel') {
      const channel = interaction.options.getChannel('channel');
      db.prepare('UPDATE guild_settings SET reminder_channel = ? WHERE guild_id = ?').run(channel.id, interaction.guildId);
      await interaction.reply(`✅ Default reminder channel set to ${channel}.`);
      await audit(interaction.client, interaction.guildId, `Reminder channel set to <#${channel.id}> by <@${interaction.user.id}>`);
      return;
    }

    if (sub === 'audit-channel') {
      const channel = interaction.options.getChannel('channel');
      db.prepare('UPDATE guild_settings SET audit_channel = ? WHERE guild_id = ?').run(channel.id, interaction.guildId);
      await interaction.reply(`✅ Audit log channel set to ${channel}.`);
      await audit(interaction.client, interaction.guildId, `Audit channel set to <#${channel.id}> by <@${interaction.user.id}>`);
      return;
    }

    if (sub === 'timezone') {
      const tz = interaction.options.getString('timezone').trim();
      if (!isValidTimezone(tz)) {
        return interaction.reply({ content: '❌ Invalid timezone. Use an IANA name like `America/New_York`, `Europe/London`, or `UTC`. See the full list at https://en.wikipedia.org/wiki/List_of_tz_database_time_zones', flags: 64 });
      }
      db.prepare('UPDATE guild_settings SET timezone = ? WHERE guild_id = ?').run(tz, interaction.guildId);
      await interaction.reply(`✅ Server timezone set to **${tz}**. Event times will now be parsed in this timezone.`);
      await audit(interaction.client, interaction.guildId, `Timezone set to ${tz} by <@${interaction.user.id}>`);
      return;
    }

    if (sub === 'event-role') {
      const subs = require('../services/subscriptions');
      const category = interaction.options.getString('category');
      const role = interaction.options.getRole('role');
      subs.setEventRole(interaction.guildId, category, role.id);
      await interaction.reply(`✅ Event role for **${category}** set to ${role}. Subscribers and this role will be pinged for reminders.`);
      await audit(interaction.client, interaction.guildId, `Event role for ${category} set to ${role} by <@${interaction.user.id}>`);
      return;
    }

    if (sub === 'announce-channel') {
      const channel = interaction.options.getChannel('channel');
      db.prepare('UPDATE guild_settings SET announce_channel = ? WHERE guild_id = ?').run(channel.id, interaction.guildId);
      await interaction.reply(`Announce channel is ${channel}. 99s and goals land there.`);
      await audit(interaction.client, interaction.guildId, `Announce channel set to <#${channel.id}> by <@${interaction.user.id}>`);
      return;
    }

    if (sub === 'view') {
      const settings = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(interaction.guildId);

      let response = '**Server Configuration:**\n\n';
      response += `WOM Group ID: ${settings.wom_group_id || 'Not set'}\n`;
      response += `WOM Verification Code: ${settings.wom_verif_code ? '✅ Set' : '❌ Not set'}\n`;
      response += `Reminder Channel: ${settings.reminder_channel ? `<#${settings.reminder_channel}>` : 'Not set'}\n`;
      response += `Audit Channel: ${settings.audit_channel ? `<#${settings.audit_channel}>` : 'Not set'}\n`;
      response += `Announce Channel: ${settings.announce_channel ? `<#${settings.announce_channel}>` : 'Not set'}\n`;
      response += `Timezone: ${settings.timezone || 'UTC (default)'}\n`;

      if (settings.wom_group_id) {
        response += `\n[WOM Group Page](https://wiseoldman.net/groups/${settings.wom_group_id})`;
      }

      await interaction.reply({ content: response, flags: 64 });
    }
  },
  adminOnly: true,
};
