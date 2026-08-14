const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getDb } = require('../db/database');
const theme = require('./theme');
const economy = require('./economy');

const LABELS = { yes: '✅ Going', maybe: '🤔 Maybe', no: '❌ Not Going' };

function buildRsvpRow(eventId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rsvp:yes:${eventId}`).setLabel('Going').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`rsvp:maybe:${eventId}`).setLabel('Maybe').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`rsvp:no:${eventId}`).setLabel('Out').setStyle(ButtonStyle.Danger),
  );
}

function getAttendance(eventId) {
  const db = getDb();
  const rows = db.prepare('SELECT user_id, status FROM event_attendance WHERE event_id = ?').all(eventId);
  const grouped = { yes: [], maybe: [], no: [] };
  for (const row of rows) {
    if (grouped[row.status]) grouped[row.status].push(row.user_id);
  }
  return grouped;
}

function formatNames(userIds, limit = 8) {
  if (userIds.length === 0) return '—';
  const shown = userIds.slice(0, limit).map(id => `<@${id}>`).join(', ');
  const extra = userIds.length > limit ? ` +${userIds.length - limit} more` : '';
  return shown + extra;
}

function buildEventContent(event, attendance = { yes: [], maybe: [], no: [] }) {
  const meta = [
    event.category && event.category !== 'general' ? event.category : null,
    event.recurrence && event.recurrence !== 'none' ? `repeats ${event.recurrence}` : null,
    `#${event.id}`,
  ].filter(Boolean).join(' · ');

  return theme.embed('event', {
    title: `${theme.categoryIcon(event.category)}  ${event.title}`,
    description: [
      event.description || theme.line('eventPosted', event.id),
      theme.when(event.event_time),
      'I’ll ping 15 minutes before. Hit **Going** if you’re in — that’s the count I run with.',
      meta,
    ].filter(Boolean).join('\n\n'),
    fields: [
      theme.field(`Going · ${attendance.yes.length}`, formatNames(attendance.yes), true),
      theme.field(`Maybe · ${attendance.maybe.length}`, formatNames(attendance.maybe), true),
      theme.field(`Out · ${attendance.no.length}`, formatNames(attendance.no), true),
      theme.field('Credits', economy.payNote('event_rsvp')),
    ],
  });
}

async function updateEventMessage(client, event) {
  const channelId = event.message_channel_id || event.channel_id;
  if (!event?.message_id || !channelId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return;
    const message = await channel.messages.fetch(event.message_id);
    const attendance = getAttendance(event.id);
    await message.edit({
      content: null,
      embeds: [buildEventContent(event, attendance)],
      components: [buildRsvpRow(event.id)],
    });
  } catch (err) {
    console.error(`Failed to update RSVP message for event ${event.id}:`, err.message);
  }
}

async function handleRsvp(interaction) {
  const db = getDb();
  const parts = interaction.customId.split(':');
  const status = parts[1];
  const eventId = parseInt(parts[2], 10);

  if (!['yes', 'maybe', 'no'].includes(status) || !eventId) {
    return interaction.reply({ content: 'Invalid RSVP button.', flags: 64 });
  }

  const event = db.prepare('SELECT * FROM events WHERE id = ? AND guild_id = ?').get(eventId, interaction.guildId);
  if (!event) {
    return interaction.reply({ content: 'That event no longer exists.', flags: 64 });
  }

  const prior = db.prepare('SELECT status FROM event_attendance WHERE event_id = ? AND user_id = ?').get(eventId, interaction.user.id);
  db.prepare(`
    INSERT INTO event_attendance (event_id, user_id, status, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status, updated_at = datetime('now')
  `).run(eventId, interaction.user.id, status);

  await updateEventMessage(interaction.client, event);
  if (status === 'yes' && prior?.status !== 'yes') {
    require('./economy').award(interaction.guildId, interaction.user.id, 'event_rsvp', interaction.client);
  }

  await interaction.reply({ content: `${LABELS[status]} · **${event.title}**`, flags: 64 });
}

module.exports = {
  LABELS,
  buildRsvpRow,
  getAttendance,
  buildEventContent,
  updateEventMessage,
  handleRsvp,
};
