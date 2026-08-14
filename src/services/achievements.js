const { getDb } = require('../db/database');
const theme = require('./theme');
const { loadPlayer } = require('../osrs/snapshot');
const { prettyMetric, KC_MILESTONES, CLOG_MILESTONES, XP_FOR_120 } = require('../osrs/catalog');
const { award } = require('./economy');

function record(guildId, userId, rsn, key, title, kind, client) {
  const db = getDb();
  const result = db.prepare(`
    INSERT OR IGNORE INTO achievements (guild_id, user_id, rsn, key, title, kind, announced)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `).run(guildId, userId, rsn, key, title, kind);
  if (result.changes > 0) {
    award(guildId, userId, 'achievement', client);
    return { key, title, kind, fresh: true };
  }
  return null;
}

function detectFromSnapshot(guildId, userId, rsn, parsed, client) {
  const found = [];
  for (const skill of parsed.skillList) {
    if (skill.level >= 99) {
      const hit = record(guildId, userId, rsn, `99:${skill.name}`, `99 ${prettyMetric(skill.name)}`, '99', client);
      if (hit) found.push(hit);
    }
    if (skill.experience >= XP_FOR_120) {
      const hit = record(guildId, userId, rsn, `120:${skill.name}`, `Virtual 120 ${prettyMetric(skill.name)}`, '120', client);
      if (hit) found.push(hit);
    }
  }
  if (parsed.maxed) {
    const hit = record(guildId, userId, rsn, 'max', 'Max cape (all 99s)', 'cape', client);
    if (hit) found.push(hit);
  }
  if (parsed.collectionLog) {
    for (const mark of CLOG_MILESTONES) {
      if (parsed.collectionLog >= mark) {
        const hit = record(guildId, userId, rsn, `clog:${mark}`, `${mark} collection log slots`, 'clog', client);
        if (hit) found.push(hit);
      }
    }
  }
  for (const boss of parsed.bossList) {
    for (const mark of KC_MILESTONES) {
      if (boss.kills >= mark) {
        const hit = record(guildId, userId, rsn, `kc:${boss.name}:${mark}`, `${mark} ${prettyMetric(boss.name)} KC`, 'kc', client);
        if (hit) found.push(hit);
      }
    }
  }
  return found;
}

async function scanMember(guildId, member, client) {
  const parsed = await loadPlayer(member.rsn, { refresh: true });
  return { parsed, fresh: detectFromSnapshot(guildId, member.user_id, member.rsn, parsed, client) };
}

function recent(guildId, userId = null, limit = 15) {
  const db = getDb();
  if (userId) {
    return db.prepare('SELECT * FROM achievements WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?').all(guildId, userId, limit);
  }
  return db.prepare('SELECT * FROM achievements WHERE guild_id = ? ORDER BY id DESC LIMIT ?').all(guildId, limit);
}

function embedFor(item, userTag) {
  return theme.embed('sotw', {
    title: item.title,
    description: `${userTag || item.rsn} just hit **${item.title}**.`,
    thumbnail: item.kind === 'kc' ? theme.skillIconUrl('slayer') : theme.skillIconUrl(item.key.split(':')[1] || 'overall'),
  });
}

async function announce(client, guildId, items, userId) {
  if (!items.length) return;
  const db = getDb();
  const settings = db.prepare('SELECT announce_channel, reminder_channel FROM guild_settings WHERE guild_id = ?').get(guildId);
  const channelId = settings?.announce_channel || settings?.reminder_channel;
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    for (const item of items) {
      await channel.send({ content: `<@${userId}>`, embeds: [embedFor(item, `<@${userId}>`)] });
      db.prepare('UPDATE achievements SET announced = 1 WHERE guild_id = ? AND user_id = ? AND key = ?').run(guildId, userId, item.key);
    }
  } catch (err) {
    console.error('Achievement announce failed:', err.message);
  }
}

module.exports = { detectFromSnapshot, scanMember, recent, announce, embedFor };
