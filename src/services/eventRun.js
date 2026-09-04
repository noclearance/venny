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
  pingMode = 'category',
  pingRoleId = null,
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

  const mode = pingMode === 'everyone' || pingMode === 'off' ? pingMode : 'category';
  const result = await db.prepare(`
    INSERT INTO events (guild_id, title, description, event_time, channel_id, created_by, recurrence, category, ping_mode, ping_role_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(guildId, name, description, eventDate.toISOString(), channel.id, userId, recurrence, category, mode, pingRoleId || null);

  const event = {
    id: result.lastInsertRowid,
    title: name,
    description,
    event_time: eventDate.toISOString(),
    channel_id: channel.id,
    recurrence,
    category,
    ping_mode: mode,
    ping_role_id: pingRoleId || null,
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
  const ping = await subs.mentionFor({
    guildId,
    category: event.category,
    mode: event.ping_mode,
    roleId: event.ping_role_id,
  });
  const made = require('./cards').venny('event', {
    job: 'event_start',
    facts: { title: event.title, category: event.category || 'general' },
    fallbackTitle: event.title,
    fallbackDescription: theme.line('eventPosted', event.id),
    extraLines: [event.description],
    fields: [
      theme.field('When', theme.when(event.event_time), true),
      theme.field('Guild credits', economy.payNote('event_rsvp')),
    ],
  });
  const cards = require('./cards');
  const announced = await cards.publish(client, guildId, {
    kind: 'event',
    json: made.json,
    extraLines: [event.description],
    fields: made.flavor.fields,
    sourceChannelId: message.channelId,
    sourceMessageId: message.id,
    mention: ping,
  });
  cards.flavorLater(message, made.flavor, announced);
  const pingNote = event.ping_mode === 'everyone' ? ' ping @everyone' : (event.ping_role_id ? ' ping role' : '');
  await audit(client, guildId, `Event #${event.id} **${event.title}** created by <@${userId}>${pingNote}`);
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
