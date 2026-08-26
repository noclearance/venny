const { getDb } = require('../db/database');
const theme = require('./theme');
const economy = require('./economy');
const { audit } = require('./audit');
const { buildRsvpRow, buildEventContent, getAttendance } = require('./rsvp');
const subs = require('./subscriptions');

async function createMass({
  client,
  guildId,
  channel,
  userId,
  title,
  about,
  eventDate,
  recurrence = 'none',
  category = 'general',
}) {
  const db = getDb();
  const name = String(title || '').trim().slice(0, 100);
  const description = String(about || '').trim().slice(0, 1000);
  if (!name) throw new Error('Give the mass a short title.');
  if (!description) throw new Error('Say what this mass actually is (world, boss, gear). I will not invent that.');
  if (!(eventDate instanceof Date) || Number.isNaN(eventDate.getTime())) {
    throw new Error('Need a start time.');
  }
  if (eventDate < new Date()) {
    throw new Error(`That time is already past (${theme.when(eventDate.toISOString())}).`);
  }

  const result = await db.prepare(`
    INSERT INTO events (guild_id, title, description, event_time, channel_id, created_by, recurrence, category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(guildId, name, description, eventDate.toISOString(), channel.id, userId, recurrence, category);

  const event = {
    id: result.lastInsertRowid,
    title: name,
    description,
    event_time: eventDate.toISOString(),
    channel_id: channel.id,
    recurrence,
    category,
  };

  const payload = {
    embeds: [buildEventContent(event, await getAttendance(event.id))],
    components: [buildRsvpRow(event.id)],
  };
  return { event, payload };
}

async function afterPosted(client, guildId, event, message, userId) {
  const db = getDb();
  await db.prepare('UPDATE events SET message_id = ?, message_channel_id = ? WHERE id = ?')
    .run(message.id, message.channelId, event.id);
  await require('./cards').publish(client, guildId, {
    kind: 'event',
    json: { title: event.title, description: event.description, source: 'staff' },
    fields: [
      theme.field('When', theme.when(event.event_time), true),
      theme.field('Guild credits', economy.payNote('event_rsvp')),
    ],
    sourceChannelId: message.channelId,
    sourceMessageId: message.id,
    mention: await subs.buildMentionString(guildId, event.category),
  });
  await audit(client, guildId, `Event #${event.id} **${event.title}** created by <@${userId}>`);
}

async function handleCreateModal(interaction) {
  const { isModerator } = require('./permissions');
  const { parseEventDate } = require('./timezone');
  const { commandFail } = require('./commandFail');
  if (!isModerator(interaction.member)) {
    return commandFail(interaction, 'Mods post masses.');
  }
  const title = interaction.fields.getTextInputValue('title');
  const about = interaction.fields.getTextInputValue('about');
  const when = interaction.fields.getTextInputValue('when');
  const parsed = await parseEventDate(when, interaction.guildId);
  if (!parsed.date) return commandFail(interaction, parsed.error);
  const { event, payload } = await createMass({
    client: interaction.client,
    guildId: interaction.guildId,
    channel: interaction.channel,
    userId: interaction.user.id,
    title,
    about,
    eventDate: parsed.date,
  });
  await interaction.reply(payload);
  const posted = await interaction.fetchReply();
  await afterPosted(interaction.client, interaction.guildId, event, posted, interaction.user.id);
}

module.exports = { createMass, afterPosted, handleCreateModal };
