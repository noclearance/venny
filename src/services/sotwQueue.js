// SOTW queue service — manage upcoming SOTWs and auto-start
const { getDb } = require('../db/database');
const { startSotw } = require('./sotw');

function addToQueue({ guildId, channelId, createdBy, skill, durationDays = 7, title = null, sourcePollId = null }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO sotw_queue (guild_id, skill, title, duration_days, channel_id, created_by, source_poll_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(guildId, skill, title, durationDays, channelId, createdBy, sourcePollId);
  return result.lastInsertRowid;
}

function getQueue(guildId) {
  const db = getDb();
  return db.prepare('SELECT * FROM sotw_queue WHERE guild_id = ? AND started_at IS NULL AND cancelled = 0 ORDER BY id ASC').all(guildId);
}

function removeFromQueue(queueId, guildId) {
  const db = getDb();
  const result = db.prepare('UPDATE sotw_queue SET cancelled = 1 WHERE id = ? AND guild_id = ?').run(queueId, guildId);
  return result.changes > 0;
}

function clearQueue(guildId) {
  const db = getDb();
  const result = db.prepare('UPDATE sotw_queue SET cancelled = 1 WHERE guild_id = ? AND started_at IS NULL AND cancelled = 0').run(guildId);
  return result.changes;
}

// Start the next queued SOTW if there's no active one
async function startNextQueuedSotw(guildId, client) {
  const db = getDb();

  // Check if there's an active SOTW
  const active = db.prepare('SELECT * FROM sotw WHERE guild_id = ? AND ended = 0').get(guildId);
  if (active) return null;

  // Get the next queued item
  const next = db.prepare('SELECT * FROM sotw_queue WHERE guild_id = ? AND started_at IS NULL AND cancelled = 0 ORDER BY id ASC').get(guildId);
  if (!next) return null;

  // Start it
  const result = await startSotw({
    guildId: next.guild_id,
    channelId: next.channel_id,
    createdBy: next.created_by,
    skill: next.skill,
    durationDays: next.duration_days,
    title: next.title || `SOTW: ${next.skill.toUpperCase()} (Queued)`,
  });

  if (result.success) {
    db.prepare('UPDATE sotw_queue SET started_at = ? WHERE id = ?').run(new Date().toISOString(), next.id);

    // Post announcement to the channel
    try {
      const channel = await client.channels.fetch(next.channel_id);
      if (channel) {
        const posted = await channel.send(result.embed
          ? { content: 'Pulled the next skill from the queue.', embeds: [result.embed] }
          : { content: `Auto-started from queue:\n\n${result.response}` });
        const theme = require('./theme');
        await require('./announce').broadcast(client, guildId, {
          kind: 'sotw',
          title: `${next.skill} SOTW`,
          description: `${theme.line('sotwOpen', next.skill)}\n\nPulled from the queue. Gains count now.`,
          fields: [theme.field('Credits', require('./economy').payNote('sotw_win'))],
          sourceChannelId: posted.channelId,
          sourceMessageId: posted.id,
        });
      }
    } catch (err) {
      console.error('Failed to post queue auto-start announcement:', err.message);
    }

    return result;
  }

  return null;
}

module.exports = { addToQueue, getQueue, removeFromQueue, clearQueue, startNextQueuedSotw };
