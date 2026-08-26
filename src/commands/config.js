const { SlashCommandBuilder } = require('discord.js');
const { getDb } = require('../db/database');
const { isAdmin, ADMIN_PERMISSION } = require('../services/permissions');
const { isValidTimezone } = require('../services/timezone');
const { audit } = require('../services/audit');

const CHANNEL_SLOTS = [
  {
    key: 'announce_channel',
    sub: 'announce-channel',
    description: 'Clan-wide board: events, raffles, SOTW, votes, bingo, 99s',
    option: 'Announce channel',
    setCopy: 'Announce channel is',
    auditCopy: 'Announce channel',
  },
  {
    key: 'reminder_channel',
    sub: 'reminder-channel',
    description: 'Set the default channel for event reminders',
    option: 'Channel for reminders',
    setCopy: 'Default reminder channel set to',
    auditCopy: 'Reminder channel',
  },
  {
    key: 'audit_channel',
    sub: 'audit-channel',
    description: 'Set the channel for action logs (event cancel, raffle draw, SOTW end)',
    option: 'Channel for audit logs',
    setCopy: 'Audit log channel set to',
    auditCopy: 'Audit channel',
  },
];

function missingChannelSlots(settings = {}) {
  return CHANNEL_SLOTS.filter(slot => !settings[slot.key]);
}

function assignedChannelSlots(settings = {}) {
  return CHANNEL_SLOTS.filter(slot => settings[slot.key]);
}

function buildData(settings = {}) {
  const cmd = new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure bot settings for this server')
    .setDefaultMemberPermissions(ADMIN_PERMISSION)
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription('View current configuration'))
    .addSubcommand(sub =>
      sub.setName('wom-group')
        .setDescription('Set the Wise Old Man group ID for your clan')
        .addIntegerOption(opt => opt.setName('group_id').setDescription('WOM group ID (find it in the URL at wiseoldman.net/groups)').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('wom-verification')
        .setDescription('Set the WOM verification code (needed for auto-creating SOTW competitions)')
        .addStringOption(opt => opt.setName('code').setDescription('Verification code from WOM group settings').setRequired(true)))
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
      sub.setName('ranks')
        .setDescription('Create Trial/Member/Veteran/Officer/Admin and check Venny sits above them'));

  for (const slot of missingChannelSlots(settings)) {
    cmd.addSubcommand(sub =>
      sub.setName(slot.sub)
        .setDescription(slot.description)
        .addChannelOption(opt => opt.setName('channel').setDescription(slot.option).setRequired(true)));
  }

  if (assignedChannelSlots(settings).length) {
    cmd.addSubcommand(sub =>
      sub.setName('clear-channel')
        .setDescription('Unassign a bot channel so its setup command comes back')
        .addStringOption(opt =>
          opt.setName('which')
            .setDescription('Which channel to unassign')
            .setRequired(true)
            .addChoices(...assignedChannelSlots(settings).map(slot => ({
              name: slot.sub,
              value: slot.key,
            })))));
  }

  return cmd;
}

async function refreshCommands(guildId) {
  try {
    await require('../deploy-commands').syncGuildCommands(guildId);
  } catch (err) {
    console.warn(`Config command refresh: ${err.message}`);
  }
}

module.exports = {
  data: buildData(),
  buildData,
  missingChannelSlots,
  CHANNEL_SLOTS,
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const db = getDb();

    if (sub !== 'view' && !isAdmin(interaction.member)) {
      return interaction.reply({ content: '❌ You need Administrator permission to change bot settings.', flags: 64 });
    }

    if (sub === 'wom-group') {
      const groupId = interaction.options.getInteger('group_id');
      await db.prepare('UPDATE guild_settings SET wom_group_id = ? WHERE guild_id = ?').run(groupId, interaction.guildId);
      await interaction.reply({ content: `WOM group ID set to **${groupId}**. Verify at https://wiseoldman.net/groups/${groupId}`, flags: 64 });
      await audit(interaction.client, interaction.guildId, `WOM group ID set to ${groupId} by <@${interaction.user.id}>`);
      return;
    }

    if (sub === 'wom-verification') {
      const code = interaction.options.getString('code');
      await db.prepare('UPDATE guild_settings SET wom_verif_code = ? WHERE guild_id = ?').run(code, interaction.guildId);
      await interaction.reply({ content: '✅ WOM verification code saved. SOTW competitions can now be auto-created on WOM.', flags: 64 });
      await audit(interaction.client, interaction.guildId, `WOM verification code updated by <@${interaction.user.id}>`);
      return;
    }

    const channelSlot = CHANNEL_SLOTS.find(slot => slot.sub === sub);
    if (channelSlot) {
      const channel = interaction.options.getChannel('channel');
      const setSql = {
        announce_channel: 'UPDATE guild_settings SET announce_channel = ? WHERE guild_id = ?',
        reminder_channel: 'UPDATE guild_settings SET reminder_channel = ? WHERE guild_id = ?',
        audit_channel: 'UPDATE guild_settings SET audit_channel = ? WHERE guild_id = ?',
      }[channelSlot.key];
      await db.prepare(setSql).run(channel.id, interaction.guildId);
      await interaction.reply({
        content: `${channelSlot.setCopy} ${channel}. That setup command drops out of the slash menu now. \`/config view\` still works. \`/config clear-channel\` brings it back.`,
        flags: 64,
      });
      await audit(interaction.client, interaction.guildId, `${channelSlot.auditCopy} set to <#${channel.id}> by <@${interaction.user.id}>`);
      await refreshCommands(interaction.guildId);
      return;
    }

    if (sub === 'clear-channel') {
      const which = interaction.options.getString('which');
      const slot = CHANNEL_SLOTS.find(s => s.key === which);
      if (!slot) {
        return interaction.reply({ content: 'Unknown channel slot.', flags: 64 });
      }
      const clearSql = {
        announce_channel: 'UPDATE guild_settings SET announce_channel = NULL WHERE guild_id = ?',
        reminder_channel: 'UPDATE guild_settings SET reminder_channel = NULL WHERE guild_id = ?',
        audit_channel: 'UPDATE guild_settings SET audit_channel = NULL WHERE guild_id = ?',
      }[slot.key];
      await db.prepare(clearSql).run(interaction.guildId);
      await interaction.reply({
        content: `${slot.auditCopy} unassigned. \`/config ${slot.sub}\` is back in the slash menu.`,
        flags: 64,
      });
      await audit(interaction.client, interaction.guildId, `${slot.auditCopy} cleared by <@${interaction.user.id}>`);
      await refreshCommands(interaction.guildId);
      return;
    }

    if (sub === 'timezone') {
      const tz = interaction.options.getString('timezone').trim();
      if (!isValidTimezone(tz)) {
        return interaction.reply({ content: '❌ Invalid timezone. Use an IANA name like `America/New_York`, `Europe/London`, or `UTC`. See the full list at https://en.wikipedia.org/wiki/List_of_tz_database_time_zones', flags: 64 });
      }
      await db.prepare('UPDATE guild_settings SET timezone = ? WHERE guild_id = ?').run(tz, interaction.guildId);
      await interaction.reply({ content: `Server timezone set to **${tz}**. Event times will now be parsed in this timezone.`, flags: 64 });
      await audit(interaction.client, interaction.guildId, `Timezone set to ${tz} by <@${interaction.user.id}>`);
      return;
    }

    if (sub === 'ranks') {
      const ranks = require('../services/ranks');
      const report = await ranks.ensure(interaction.guild);
      const theme = require('../services/theme');
      await interaction.reply({
        embeds: [theme.embed('info', {
          title: 'Clan ranks',
          description: [
            ranks.formatReport(report),
            'Hub still assigns the rank (`POST /api/sync-rank` with `{ discord_id, rank }`). I only put the Discord role on.',
          ].join('\n\n'),
        })],
        flags: 64,
      });
      await audit(interaction.client, interaction.guildId, `Clan ranks checked by <@${interaction.user.id}>`);
      return;
    }

    if (sub === 'event-role') {
      const subs = require('../services/subscriptions');
      const category = interaction.options.getString('category');
      const role = interaction.options.getRole('role');
      await subs.setEventRole(interaction.guildId, category, role.id);
      await interaction.reply({ content: `Event role for **${category}** set to ${role}. Subscribers and this role will be pinged for reminders.`, flags: 64 });
      await audit(interaction.client, interaction.guildId, `Event role for ${category} set to ${role} by <@${interaction.user.id}>`);
      return;
    }

    if (sub === 'view') {
      const settings = await db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(interaction.guildId) || {};
      const missing = missingChannelSlots(settings);

      let response = '**Server Configuration:**\n\n';
      response += `WOM Group ID: ${settings.wom_group_id || 'Not set'}\n`;
      response += `WOM Verification Code: ${settings.wom_verif_code ? '✅ Set' : '❌ Not set'}\n`;
      response += `Reminder Channel: ${settings.reminder_channel ? `<#${settings.reminder_channel}>` : 'Not set'}\n`;
      response += `Audit Channel: ${settings.audit_channel ? `<#${settings.audit_channel}>` : 'Not set'}\n`;
      response += `Announce Channel: ${settings.announce_channel ? `<#${settings.announce_channel}>` : 'Not set'}\n`;
      response += `Timezone: ${settings.timezone || 'UTC (default)'}\n`;

      if (missing.length) {
        response += `\nStill need: ${missing.map(s => `\`/config ${s.sub}\``).join(', ')}`;
      } else {
        response += '\nChannel setup commands are hidden. `/config clear-channel` brings one back if you need to move it.';
      }

      if (settings.wom_group_id) {
        response += `\n[WOM Group Page](https://wiseoldman.net/groups/${settings.wom_group_id})`;
      }

      await interaction.reply({ content: response, flags: 64 });
    }
  },
  adminOnly: true,
};
