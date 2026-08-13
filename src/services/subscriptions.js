// Subscriptions service — DB-based event category subscriptions
const { getDb } = require('../db/database');

const CATEGORIES = ['general', 'boss', 'pvm', 'skilling', 'social', 'sotw', 'botw', 'raffle'];

function subscribe(guildId, userId, category) {
  const db = getDb();
  try {
    db.prepare('INSERT INTO event_subscriptions (guild_id, user_id, category) VALUES (?, ?, ?)').run(guildId, userId, category);
    return true;
  } catch (err) {
    if (err.message.includes('UNIQUE')) return false; // already subscribed
    throw err;
  }
}

function unsubscribe(guildId, userId, category) {
  const db = getDb();
  const result = db.prepare('DELETE FROM event_subscriptions WHERE guild_id = ? AND user_id = ? AND category = ?').run(guildId, userId, category);
  return result.changes > 0;
}

function unsubscribeAll(guildId, userId) {
  const db = getDb();
  const result = db.prepare('DELETE FROM event_subscriptions WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
  return result.changes;
}

function getSubscriptions(guildId, userId) {
  const db = getDb();
  return db.prepare('SELECT category FROM event_subscriptions WHERE guild_id = ? AND user_id = ?').all(guildId, userId).map(r => r.category);
}

function getSubscribedUsers(guildId, category) {
  const db = getDb();
  return db.prepare('SELECT user_id FROM event_subscriptions WHERE guild_id = ? AND category = ?').all(guildId, category).map(r => r.user_id);
}

function getEventRole(guildId, category) {
  const db = getDb();
  const row = db.prepare('SELECT role_id FROM event_roles WHERE guild_id = ? AND category = ?').get(guildId, category);
  return row?.role_id || null;
}

function setEventRole(guildId, category, roleId) {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO event_roles (guild_id, category, role_id) VALUES (?, ?, ?)').run(guildId, category, roleId);
}

// Build the mention string for an event reminder
function buildMentionString(guildId, category) {
  const roleId = getEventRole(guildId, category);
  if (roleId) {
    return `<@&${roleId}>`;
  }

  const userIds = getSubscribedUsers(guildId, category);
  if (userIds.length === 0) return '';

  return userIds.map(id => `<@${id}>`).join(' ');
}

module.exports = {
  CATEGORIES,
  subscribe,
  unsubscribe,
  unsubscribeAll,
  getSubscriptions,
  getSubscribedUsers,
  getEventRole,
  setEventRole,
  buildMentionString,
};
