const { getDb } = require('../db/database');
const theme = require('./theme');
const { prettyMetric, KC_MILESTONES, CLOG_MILESTONES, XP_FOR_120 } = require('../osrs/catalog');
const { award } = require('./economy');

async function record(guildId, userId, rsn, key, title, kind, client, { silent = false } = {}) {
  const db = getDb();
  const result = await db.prepare(`
    INSERT OR IGNORE INTO achievements (guild_id, user_id, rsn, key, title, kind, announced)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(guildId, userId, rsn, key, title, kind, silent ? 1 : 0);
  if (result.changes > 0) {
    if (!silent) await award(guildId, userId, 'achievement', client, key);
    return { key, title, kind, fresh: !silent };
  }
  return null;
}

async function detectFromSnapshot(guildId, userId, rsn, parsed, client, { silent = false } = {}) {
  const found = [];
  for (const skill of parsed.skillList) {
    if (skill.level >= 99) {
      const hit = await record(guildId, userId, rsn, `99:${skill.name}`, `99 ${prettyMetric(skill.name)}`, '99', client, { silent });
      if (hit) found.push(hit);
    }
    if (skill.experience >= XP_FOR_120) {
      const hit = await record(guildId, userId, rsn, `120:${skill.name}`, `Virtual 120 ${prettyMetric(skill.name)}`, '120', client, { silent });
      if (hit) found.push(hit);
    }
  }
  if (parsed.maxed) {
    const hit = await record(guildId, userId, rsn, 'max', 'Max cape (all 99s)', 'cape', client, { silent });
    if (hit) found.push(hit);
  }
  if (parsed.collectionLog) {
    for (const mark of CLOG_MILESTONES) {
      if (parsed.collectionLog >= mark) {
        const hit = await record(guildId, userId, rsn, `clog:${mark}`, `${mark} collection log slots`, 'clog', client, { silent });
        if (hit) found.push(hit);
      }
    }
  }
  for (const boss of parsed.bossList) {
    for (const mark of KC_MILESTONES) {
      if (boss.kills >= mark) {
        const hit = await record(guildId, userId, rsn, `kc:${boss.name}:${mark}`, `${mark} ${prettyMetric(boss.name)} KC`, 'kc', client, { silent });
        if (hit) found.push(hit);
      }
    }
  }
  return found;
}

async function scanMember(guildId, member, client) {
  const { loadPlayer, readCache, cacheProfile } = require('../osrs/snapshot');
  const prev = await readCache(guildId, member.user_id);
  const parsed = await loadPlayer(member.rsn, { refresh: true });
  const silent = !prev;
  const fresh = await detectFromSnapshot(guildId, member.user_id, member.rsn, parsed, client, { silent });
  await cacheProfile(guildId, member.user_id, member.rsn, parsed);
  return { parsed, fresh: silent ? [] : fresh };
}

async function recent(guildId, userId = null, limit = 15) {
  const db = getDb();
  if (userId) {
    return await db.prepare('SELECT * FROM achievements WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?').all(guildId, userId, limit);
  }
  return await db.prepare('SELECT * FROM achievements WHERE guild_id = ? ORDER BY id DESC LIMIT ?').all(guildId, limit);
}

const FACE = {
  kc: 'danger',
  99: 'achieve',
  120: 'achieve',
  clog: 'achieve',
  cape: 'achieve',
};

function thumbFor(item) {
  const metric = String(item.key || '').split(':')[1] || '';
  if (item.kind === 'kc') {
    const file = prettyMetric(metric).replace(/ /g, '_');
    return `https://oldschool.runescape.wiki/images/${encodeURIComponent(file)}.png`;
  }
  if (item.kind === 'clog') return 'https://oldschool.runescape.wiki/images/Collection_log.png';
  if (item.kind === 'cape') return 'https://oldschool.runescape.wiki/images/Max_cape.png';
  return theme.skillIconUrl(metric || 'overall');
}

function embedFor(item, userTag) {
  const kind = FACE[item.kind] || 'achieve';
  return theme.embed(kind, {
    title: item.title,
    description: `${userTag || item.rsn} just hit **${item.title}**.`,
    thumbnail: thumbFor(item),
  });
}

async function announce(client, guildId, items, userId) {
  if (!items.length) return;
  const db = getDb();
  const settings = await db.prepare('SELECT announce_channel, reminder_channel FROM guild_settings WHERE guild_id = ?').get(guildId);
  const channelId = settings?.announce_channel || settings?.reminder_channel;
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    for (const item of items) {
      await channel.send({ content: `<@${userId}>`, embeds: [embedFor(item, `<@${userId}>`)] });
      await db.prepare('UPDATE achievements SET announced = 1 WHERE guild_id = ? AND user_id = ? AND key = ?').run(guildId, userId, item.key);
    }
  } catch (err) {
    console.error('Achievement announce failed:', err.message);
  }
}

module.exports = { detectFromSnapshot, scanMember, recent, announce, embedFor };
