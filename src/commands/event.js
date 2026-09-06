const { SlashCommandBuilder } = require('discord.js');
const { getDb } = require('../db/database');
const { parseEventDate } = require('../services/timezone');
const { commandFail } = require('../services/commandFail');
const { isModerator } = require('../services/permissions');
const { buildConfirmationRow } = require('../services/confirmations');
const { getPaginatedData, buildPagePayload } = require('../services/pagination');
const subs = require('../services/subscriptions');
const theme = require('../services/theme');
const economy = require('../services/economy');


module.exports = {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('Clan masses and calendar — not Skill of the Week')
    .addSubcommand(sub => {
      sub.setName('create')
        .setDescription('Post a mass / hangout with RSVP and a 15-minute reminder')
        .addStringOption(opt =>
          opt.setName('title')
            .setDescription('Short name, e.g. ToB mass')
            .setRequired(true)
            .setMaxLength(100))
        .addStringOption(opt =>
          opt.setName('about')
            .setDescription('What this actually is — world, gear, who should come. Not optional.')
            .setRequired(true)
            .setMaxLength(1000))
        .addStringOption(opt => opt.setName('datetime').setDescription('When it starts, e.g. 2026-08-25 19:00 or Dec 25 2026 7pm (server TZ, or append EST/PST)').setRequired(true))
        .addChannelOption(opt => opt.setName('channel').setDescription('Channel for reminders (defaults to current channel)').setRequired(false))
        .addStringOption(opt =>
          opt.setName('recurring')
            .setDescription('Repeat this event automatically')
            .setRequired(false)
            .addChoices(
              { name: 'None (one-time)', value: 'none' },
              { name: 'Weekly', value: 'weekly' },
              { name: 'Monthly', value: 'monthly' },
            ))
        .addStringOption(opt =>
          opt.setName('category')
            .setDescription('Event category — subscribers get pinged')
            .setRequired(false)
            .addChoices(
              { name: 'General', value: 'general' },
              { name: 'Boss Masses', value: 'boss' },
              { name: 'PvM', value: 'pvm' },
              { name: 'Skilling', value: 'skilling' },
              { name: 'Social', value: 'social' },
            ));
      return subs.addPingOptions(sub);
    })
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List upcoming events'))
    .addSubcommand(sub =>
      sub.setName('cancel')
        .setDescription('Cancel an event')
        .addIntegerOption(opt => opt.setName('id').setDescription('Which event').setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub =>
      sub.setName('remind')
        .setDescription('Send a manual reminder for an event')
        .addIntegerOption(opt => opt.setName('id').setDescription('Which event').setRequired(true).setAutocomplete(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const db = getDb();

    if (['create', 'cancel', 'remind'].includes(sub) && !isModerator(interaction.member)) {
      return interaction.reply({ content: '❌ You need **Manage Events**, **Manage Server**, or **Administrator** permission to manage events. Use `/event list` to view upcoming events.', flags: 64 });
    }

    if (sub === 'create') {
      const title = interaction.options.getString('title').trim();
      const datetimeStr = interaction.options.getString('datetime');
      const description = (interaction.options.getString('about') || '').trim();
      if (!description) {
        return commandFail(interaction, 'Tell me what this mass actually is in **about** (world, boss, gear, who should show). I will not invent that.');
      }
      const recurrence = interaction.options.getString('recurring') || 'none';
      const category = interaction.options.getString('category') || 'general';
      const ping = subs.pingFromInteraction(interaction);
      try {
        subs.assertCanPing(interaction.member, interaction.guild.members.me, ping);
      } catch (err) {
        return commandFail(interaction, err);
      }
      const channelOption = interaction.options.getChannel('channel');
      const settings = await db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(interaction.guildId);
      const channel = channelOption || (settings && settings.reminder_channel ? await interaction.client.channels.fetch(settings.reminder_channel).catch(() => null) : null) || interaction.channel;

      const parsed = await parseEventDate(datetimeStr, interaction.guildId);
      if (!parsed.date) {
        return commandFail(interaction, parsed.error);
      }
      try {
        const { createMass, afterPosted } = require('../services/eventRun');
        const { event, payload, made } = await createMass({
          client: interaction.client,
          guildId: interaction.guildId,
          channel,
          userId: interaction.user.id,
          title,
          about: description,
          eventDate: parsed.date,
          recurrence,
          category,
          pingMode: ping.mode,
          pingRoleId: ping.roleId,
        });
        const launch = await subs.mentionFor({
          guildId: interaction.guildId,
          category,
          mode: ping.mode,
          roleId: ping.roleId,
        });
        await interaction.reply({
          ...payload,
          content: launch.content,
          allowedMentions: launch.allowedMentions,
        });
        const reply = await interaction.fetchReply();
        await afterPosted(interaction.client, interaction.guildId, event, reply, interaction.user.id, made);
      } catch (err) {
        return commandFail(interaction, err);
      }
      return;
    }

    if (sub === 'list') {
      const data = await getPaginatedData('events', interaction.guildId, 0);
      if (!data || data.total === 0) {
        return interaction.reply({ content: 'No upcoming events. Create one with `/event create`!', flags: 64 });
      }
      await interaction.reply(buildPagePayload('events', data, 0, interaction.guildId));
      return;
    }

    if (sub === 'cancel') {
      const id = interaction.options.getInteger('id');
      const event = await db.prepare('SELECT * FROM events WHERE id = ? AND guild_id = ?').get(id, interaction.guildId);

      if (!event) {
        return interaction.reply({ content: `❌ Event #${id} not found.`, flags: 64 });
      }

      const row = buildConfirmationRow('event_cancel', String(id), interaction.user.id);
      await interaction.reply({
        content: `⚠️ **Cancel event #${id}: ${event.title}?**\nThis cannot be undone.`,
        components: [row],
        flags: 64,
      });
      return;
    }

    if (sub === 'remind') {
      const id = interaction.options.getInteger('id');
      const event = await db.prepare('SELECT * FROM events WHERE id = ? AND guild_id = ?').get(id, interaction.guildId);

      if (!event) {
        return interaction.reply({ content: `❌ Event #${id} not found.`, flags: 64 });
      }

      const alreadyReminded = Number(event.reminder_sent) === 1;
      const ping = alreadyReminded
        ? subs.QUIET
        : await subs.mentionFor({
          guildId: event.guild_id,
          category: event.category || 'general',
          mode: event.ping_mode,
          roleId: event.ping_role_id,
          forReminder: true,
        });
      const made = await require('../services/cards').make('event', {
        job: 'event_remind',
        facts: { title: event.title, category: event.category || 'general', alreadyReminded, seed: event.id },
        fallbackTitle: event.title,
        fallbackDescription: event.description || theme.line('eventSoon', event.id),
        extraLines: [
          event.description || null,
          theme.when(event.event_time),
          alreadyReminded ? 'Posted quietly — this event was already reminded.' : 'If you’re coming, be logged in.',
        ],
        fields: [
          theme.field('Guild credits', economy.payNote('event_rsvp')),
        ],
      });
      await interaction.reply({
        content: ping.content,
        embeds: [made.embed],
        allowedMentions: ping.allowedMentions,
      });
      if (!alreadyReminded) {
        await db.prepare('UPDATE events SET reminder_sent = 1 WHERE id = ?').run(event.id);
      }
    }
  },
  staffSubs: ['create', 'cancel', 'remind'],
  publicSubs: ['create', 'remind'],

  async autocomplete(interaction) {
    const { getDb } = require('../db/database');
    const { filterChoices, respond } = require('../services/autocomplete');
    const db = getDb();
    const now = new Date().toISOString();
    const upcoming = await db.prepare(`
      SELECT id, title, event_time FROM events
      WHERE guild_id = ? AND event_time >= ? AND ${require('../services/calendar').MASS}
      ORDER BY event_time ASC LIMIT 25
    `).all(interaction.guildId, now);
    const rows = upcoming.length
      ? upcoming
      : await db.prepare(`
          SELECT id, title, event_time FROM events
          WHERE guild_id = ? AND ${require('../services/calendar').MASS}
          ORDER BY event_time DESC LIMIT 25
        `).all(interaction.guildId);

    const focused = interaction.options.getFocused(true);
    await respond(interaction, filterChoices(rows, focused.value, ev => ({
      name: `#${ev.id} · ${ev.title}`,
      value: ev.id,
    })));
  },
};
