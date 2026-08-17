const { SlashCommandBuilder } = require('discord.js');
const { getDb } = require('../db/database');
const { parseEventDate } = require('../services/timezone');
const { isModerator } = require('../services/permissions');
const { buildConfirmationRow } = require('../services/confirmations');
const { buildRsvpRow, buildEventContent, getAttendance } = require('../services/rsvp');
const { getPaginatedData, buildPagePayload } = require('../services/pagination');
const { audit } = require('../services/audit');
const subs = require('../services/subscriptions');
const theme = require('../services/theme');
const economy = require('../services/economy');
const { broadcast } = require('../services/announce');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('Manage clan events and reminders')
    .addSubcommand(sub =>
      sub.setName('create')
        .setDescription('Create a new event with automatic reminders')
        .addStringOption(opt => opt.setName('title').setDescription('Event title').setRequired(true))
        .addStringOption(opt => opt.setName('datetime').setDescription('When the event starts (e.g. "2024-12-25 19:00" — uses server timezone or append EST/PST/etc)').setRequired(true))
        .addStringOption(opt => opt.setName('description').setDescription('Event details, location, requirements, etc.').setRequired(false))
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
            )))
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
      const title = interaction.options.getString('title');
      const datetimeStr = interaction.options.getString('datetime');
      const description = interaction.options.getString('description') || '';
      const recurrence = interaction.options.getString('recurring') || 'none';
      const category = interaction.options.getString('category') || 'general';
      const channelOption = interaction.options.getChannel('channel');
      const settings = await db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(interaction.guildId);
      const channel = channelOption || (settings && settings.reminder_channel ? await interaction.client.channels.fetch(settings.reminder_channel).catch(() => null) : null) || interaction.channel;

      const eventDate = await parseEventDate(datetimeStr, interaction.guildId);
      if (!eventDate) {
        return interaction.reply({ content: '❌ Could not parse that date/time. Try a format like `2024-12-25 19:00` or `Dec 25 2024 7pm`. Set your server timezone with `/config timezone`.', flags: 64 });
      }

      if (eventDate < new Date()) {
        return interaction.reply({ content: '❌ That date is in the past.', flags: 64 });
      }

      const result = await db.prepare(`
        INSERT INTO events (guild_id, title, description, event_time, channel_id, created_by, recurrence, category)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(interaction.guildId, title, description, eventDate.toISOString(), channel.id, interaction.user.id, recurrence, category);

      const event = {
        id: result.lastInsertRowid,
        title,
        description,
        event_time: eventDate.toISOString(),
        channel_id: channel.id,
        recurrence,
        category,
      };

      const flavor = require('../services/flavor');
      const card = await flavor.write({
        job: 'event_start',
        facts: { title, category, staffNotes: description || null },
        fallbackTitle: title,
        fallbackDescription: description || theme.line('eventPosted', event.id),
      });

      await interaction.reply({
        embeds: [buildEventContent(event, await getAttendance(event.id), {
          title: card.title,
          intro: card.description,
          color: card.color,
        })],
        components: [buildRsvpRow(event.id)],
      });

      const reply = await interaction.fetchReply();
      await db.prepare('UPDATE events SET message_id = ?, message_channel_id = ? WHERE id = ?').run(reply.id, reply.channelId, event.id);
      await broadcast(interaction.client, interaction.guildId, {
        kind: 'event',
        job: 'event_start',
        card,
        fields: [
          theme.field('When', theme.when(event.event_time), true),
          theme.field('Guild credits', economy.payNote('event_rsvp')),
        ],
        sourceChannelId: reply.channelId,
        sourceMessageId: reply.id,
        mention: await subs.buildMentionString(interaction.guildId, category),
      });
      await audit(interaction.client, interaction.guildId, `Event #${event.id} **${title}** created by <@${interaction.user.id}>`);
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
      const mentionStr = alreadyReminded
        ? null
        : await subs.buildMentionString(event.guild_id, event.category || 'general');
      const flavor = require('../services/flavor');
      const card = await flavor.write({
        job: 'event_remind',
        facts: { title: event.title, category: event.category || 'general', alreadyReminded },
        fallbackTitle: event.title,
        fallbackDescription: event.description || theme.line('eventSoon', event.id),
      });
      await interaction.reply({
        content: mentionStr || undefined,
        embeds: [theme.fromJson('event', card, {
          description: [
            card.description,
            event.description && event.description !== card.description ? event.description : null,
            theme.when(event.event_time),
            alreadyReminded ? 'Posted quietly — this event was already reminded.' : 'If you’re coming, be logged in.',
          ].filter(Boolean).join('\n\n'),
          fields: [
            theme.field('Guild credits', economy.payNote(event.category === 'sotw' ? 'sotw_win' : 'event_rsvp')),
          ],
        })],
        allowedMentions: alreadyReminded ? { parse: [] } : { parse: ['users', 'roles'] },
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
      WHERE guild_id = ? AND event_time >= ?
      ORDER BY event_time ASC LIMIT 25
    `).all(interaction.guildId, now);
    const rows = upcoming.length
      ? upcoming
      : await db.prepare(`
          SELECT id, title, event_time FROM events
          WHERE guild_id = ? ORDER BY event_time DESC LIMIT 25
        `).all(interaction.guildId);

    const focused = interaction.options.getFocused(true);
    await respond(interaction, filterChoices(rows, focused.value, ev => ({
      name: `#${ev.id} · ${ev.title}`,
      value: ev.id,
    })));
  },
};
