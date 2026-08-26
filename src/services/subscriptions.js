// Subscriptions service — DB-based event category subscriptions
const { getDb } = require('../db/database');

const CATEGORIES = ['general', 'boss', 'pvm', 'skilling', 'social', 'sotw', 'botw', 'raffle'];

async function subscribe(guildId, userId, category) {
  const db = getDb();
  try {
    await db.prepare('INSERT INTO event_subscriptions (guild_id, user_id, category) VALUES (?, ?, ?)').run(guildId, userId, category);
    return true;
  } catch (err) {
    if (err.message.includes('UNIQUE')) return false; // already subscribed
    throw err;
  }
}

async function unsubscribe(guildId, userId, category) {
  const db = getDb();
  const result = await db.prepare('DELETE FROM event_subscriptions WHERE guild_id = ? AND user_id = ? AND category = ?').run(guildId, userId, category);
  return result.changes > 0;
}

async function unsubscribeAll(guildId, userId) {
  const db = getDb();
  const result = await db.prepare('DELETE FROM event_subscriptions WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
  return result.changes;
}

async function getSubscriptions(guildId, userId) {
  const db = getDb();
  return (await db.prepare('SELECT category FROM event_subscriptions WHERE guild_id = ? AND user_id = ?').all(guildId, userId)).map(r => r.category);
}

async function getSubscribedUsers(guildId, category) {
  const db = getDb();
  return (await db.prepare('SELECT user_id FROM event_subscriptions WHERE guild_id = ? AND category = ?').all(guildId, category)).map(r => r.user_id);
}

async function getEventRole(guildId, category) {
  const db = getDb();
  const row = await db.prepare('SELECT role_id FROM event_roles WHERE guild_id = ? AND category = ?').get(guildId, category);
  return row?.role_id || null;
}

async function setEventRole(guildId, category, roleId) {
  const db = getDb();
  await db.prepare('INSERT OR REPLACE INTO event_roles (guild_id, category, role_id) VALUES (?, ?, ?)').run(guildId, category, roleId);
}

// Build the mention string for an event reminder
async function buildMentionString(guildId, category) {
  const roleId = await getEventRole(guildId, category);
  if (roleId) {
    return `<@&${roleId}>`;
  }

  const userIds = await getSubscribedUsers(guildId, category);
  if (userIds.length === 0) return '';

  return userIds.map(id => `<@${id}>`).join(' ');
}

const QUIET = { content: undefined, allowedMentions: { parse: [] } };

function allowedFor(content) {
  if (!content) return { parse: [] };
  if (/@everyone|@here/.test(content)) {
    return { parse: ['everyone', 'roles', 'users'] };
  }
  return { parse: ['roles', 'users'] };
}

function pingFromInteraction(interaction) {
  const mode = interaction.options.getString('ping') || 'category';
  const role = interaction.options.getRole('ping_role');
  return { mode, roleId: role ? role.id : null, role: role || null };
}

function addPingOptions(sub) {
  return sub
    .addStringOption(opt =>
      opt.setName('ping')
        .setDescription('Who to ping on the launch post')
        .setRequired(false)
        .addChoices(
          { name: 'Category role or subscribers (default)', value: 'category' },
          { name: '@everyone (launch only, not the reminder)', value: 'everyone' },
          { name: 'Nobody', value: 'off' },
        ))
    .addRoleOption(opt =>
      opt.setName('ping_role')
        .setDescription('Ping this role instead — Trial/Member from /config ranks works'));
}

function assertCanPing(member, me, ping) {
  const { PermissionFlagsBits } = require('discord.js');
  const everyone = ping?.mode === 'everyone';
  const needsEveryone = everyone || (ping?.role && ping.role.mentionable === false);
  if (!needsEveryone) return;
  if (!member?.permissions?.has(PermissionFlagsBits.MentionEveryone)) {
    throw new Error('You need **Mention Everyone** to ping @everyone or a rank role that is not set mentionable (Trial/Member from `/config ranks`).');
  }
  if (!me?.permissions?.has(PermissionFlagsBits.MentionEveryone)) {
    throw new Error('Venny needs **Mention Everyone** for that ping. Turn it on for the bot role.');
  }
}

async function mentionFor({
  guildId,
  category = 'general',
  mode = 'category',
  roleId = null,
  forReminder = false,
} = {}) {
  const m = String(mode || 'category');
  if (m === 'off' || m === 'none') return QUIET;
  if (m === 'everyone' && !forReminder) {
    return { content: '@everyone', allowedMentions: { parse: ['everyone'] } };
  }
  if (roleId) {
    return { content: `<@&${roleId}>`, allowedMentions: { parse: ['roles'] } };
  }
  const text = await buildMentionString(guildId, category);
  if (!text) return QUIET;
  return { content: text, allowedMentions: allowedFor(text) };
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
  mentionFor,
  pingFromInteraction,
  addPingOptions,
  assertCanPing,
  QUIET,
};
