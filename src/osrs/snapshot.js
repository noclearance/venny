const { getDb } = require('../db/database');
const wom = require('../services/wom');
const { XP_FOR_120 } = require('./catalog');

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function parsePlayer(details) {
  const data = details.latestSnapshot?.data || {};
  const skills = data.skills || {};
  const bosses = data.bosses || {};
  const activities = data.activities || {};
  const overall = skills.overall || {};

  const skillList = Object.entries(skills)
    .filter(([key, row]) => key !== 'overall' && row && num(row.experience) > 0)
    .map(([key, row]) => ({
      name: key,
      level: num(row.level),
      experience: num(row.experience),
      rank: num(row.rank),
    }))
    .sort((a, b) => b.experience - a.experience);

  const bossList = Object.entries(bosses)
    .filter(([, row]) => row && num(row.kills) > 0)
    .map(([key, row]) => ({
      name: key,
      kills: num(row.kills),
      rank: num(row.rank),
    }))
    .sort((a, b) => b.kills - a.kills);

  const clues = {};
  for (const [key, row] of Object.entries(activities)) {
    if (key.startsWith('clue_scrolls_')) clues[key] = num(row.score);
  }

  const ninetynines = skillList.filter(s => s.level >= 99);
  const virtual120 = skillList.filter(s => s.experience >= XP_FOR_120);
  const combatSkills = ['attack', 'defence', 'strength', 'hitpoints', 'ranged', 'prayer', 'magic'];
  const all99 = skillList.length >= 23 && skillList.every(s => s.level >= 99);

  return {
    username: details.username,
    displayName: details.displayName,
    type: details.type,
    combatLevel: details.combatLevel,
    ehp: details.ehp || 0,
    ehb: details.ehb || 0,
    totalXp: num(details.exp || overall.experience),
    totalLevel: num(overall.level),
    overallRank: num(overall.rank),
    skills,
    skillList,
    bosses,
    bossList,
    activities,
    clues,
    collectionLog: num(activities.collections_logged?.score),
    ninetynines,
    virtual120,
    maxed: all99,
    combatOnly99: combatSkills.every(s => num(skills[s]?.level) >= 99),
    fetchedAt: new Date().toISOString(),
  };
}

function compactSnapshot(parsed) {
  const skills = {};
  for (const s of parsed.skillList) skills[s.name] = s.experience;
  skills.overall = parsed.totalXp;
  const bosses = {};
  for (const b of parsed.bossList) bosses[b.name] = b.kills;
  const activities = { ...parsed.clues, collections_logged: parsed.collectionLog };
  return { skills, bosses, activities, levels: Object.fromEntries(parsed.skillList.map(s => [s.name, s.level])) };
}

async function loadPlayer(rsn, { refresh = false } = {}) {
  const details = refresh
    ? await wom.updatePlayer(rsn).catch(() => wom.getPlayerDetails(rsn))
    : await wom.getPlayerDetails(rsn);
  return parsePlayer(details);
}

function cacheProfile(guildId, userId, rsn, parsed) {
  const db = getDb();
  db.prepare(`
    INSERT INTO profile_cache (guild_id, user_id, rsn, payload, fetched_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(guild_id, user_id) DO UPDATE SET rsn = excluded.rsn, payload = excluded.payload, fetched_at = excluded.fetched_at
  `).run(guildId, userId, rsn, JSON.stringify(parsed));
}

function readCache(guildId, userId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM profile_cache WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  if (!row) return null;
  try {
    return { ...JSON.parse(row.payload), cachedAt: row.fetched_at };
  } catch {
    return null;
  }
}

module.exports = { parsePlayer, compactSnapshot, loadPlayer, cacheProfile, readCache, num };
