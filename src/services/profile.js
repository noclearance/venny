const { getDb } = require('../db/database');
const wom = require('./wom');
const theme = require('./theme');
const { prettyMetric, jagexAvatar, CLUE_METRICS } = require('../osrs/catalog');
const { loadPlayer, cacheProfile } = require('../osrs/snapshot');

const SECTIONS = ['overview', 'skills', 'bosses', 'clues', 'clan', 'sotw', 'raffles', 'events'];

function dash(n) {
  return n > 0 ? n.toLocaleString() : '—';
}

async function buildProfile({ guildId, user, memberRow, discordMember }) {
  const parsed = await loadPlayer(memberRow.rsn, { refresh: true });
  cacheProfile(guildId, memberRow.user_id, memberRow.rsn, parsed);

  const db = getDb();
  const clanPlayer = db.prepare('SELECT * FROM clan_players WHERE guild_id = ? AND rsn = ?').get(guildId, memberRow.rsn);
  let womRole = clanPlayer?.role || null;
  try {
    const groups = await wom.getPlayerGroups(memberRow.rsn);
    const settings = db.prepare('SELECT wom_group_id FROM guild_settings WHERE guild_id = ?').get(guildId);
    const ours = Array.isArray(groups) ? groups.find(g => g.groupId === settings?.wom_group_id || g.group?.id === settings?.wom_group_id) : null;
    if (ours?.role) womRole = ours.role;
  } catch { /* optional */ }

  const sotwWins = db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(xp_gained),0) as xp FROM sotw_winners WHERE guild_id = ? AND winner_rsn = ?').get(guildId, memberRow.rsn);
  const raffleWins = db.prepare('SELECT COUNT(*) as count FROM raffles WHERE guild_id = ? AND winner_id = ? AND drawn = 1').get(guildId, memberRow.user_id);
  const raffleEntries = db.prepare(`
    SELECT COUNT(*) as count FROM raffle_entries re
    JOIN raffles r ON r.id = re.raffle_id
    WHERE r.guild_id = ? AND re.user_id = ?
  `).get(guildId, memberRow.user_id);
  const attendance = db.prepare(`
    SELECT
      SUM(CASE WHEN ea.status = 'yes' THEN 1 ELSE 0 END) as yes,
      COUNT(*) as total
    FROM event_attendance ea
    JOIN events e ON e.id = ea.event_id
    WHERE e.guild_id = ? AND ea.user_id = ?
  `).get(guildId, memberRow.user_id);
  const recentAch = db.prepare('SELECT title FROM achievements WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 5').all(guildId, memberRow.user_id);

  const discordRoles = discordMember?.roles?.cache
    ? [...discordMember.roles.cache.values()]
      .filter(r => r.id !== guildId)
      .sort((a, b) => b.position - a.position)
      .slice(0, 6)
      .map(r => r.name)
    : [];

  const topSkills = parsed.skillList.slice(0, 5).map(s =>
    `${wom.getSkillEmoji(s.name)} **${prettyMetric(s.name)}** ${s.level} · ${dash(s.experience)} XP · #${dash(s.rank)}`
  ).join('\n') || '—';

  const topBosses = parsed.bossList.slice(0, 10).map(b =>
    `**${prettyMetric(b.name)}** ${dash(b.kills)} KC`
  ).join('\n') || 'Hiscores have no KC yet.';

  const clueLine = CLUE_METRICS.map(key => {
    const n = parsed.clues[key] || 0;
    if (!n) return null;
    return `**${prettyMetric(key.replace('clue_scrolls_', ''))}** ${n}`;
  }).filter(Boolean).join(' · ') || 'No clues ranked.';

  const recent = [];
  for (const s of parsed.ninetynines.slice(0, 6)) recent.push(`99 ${prettyMetric(s.name)}`);
  if (parsed.maxed) recent.push('Max cape eligible');
  if (parsed.collectionLog) recent.push(`Clog ${parsed.collectionLog}`);
  for (const row of recentAch) recent.push(row.title);

  const overview = theme.embed('info', {
    title: parsed.displayName,
    url: `https://wiseoldman.net/players/${encodeURIComponent(parsed.username)}`,
    thumbnail: jagexAvatar(parsed.displayName),
    description: `${user} · **${parsed.type || 'regular'}**`,
    fields: [
      theme.field('Combat', `${parsed.combatLevel || '—'}`, true),
      theme.field('Total level', dash(parsed.totalLevel), true),
      theme.field('Total XP', dash(parsed.totalXp), true),
      theme.field('EHP', (parsed.ehp || 0).toFixed(1), true),
      theme.field('EHB', (parsed.ehb || 0).toFixed(1), true),
      theme.field('Clog', dash(parsed.collectionLog), true),
    ],
  });

  const skills = theme.embed('sotw', {
    title: `Skills · ${parsed.displayName}`,
    thumbnail: theme.skillIconUrl(parsed.skillList[0]?.name || 'overall'),
    description: topSkills,
    fields: [
      theme.field('99s', String(parsed.ninetynines.length), true),
      theme.field('Virtual 120s', String(parsed.virtual120.length), true),
    ],
  });

  const bosses = theme.embed('danger', {
    title: `Bosses · ${parsed.displayName}`,
    description: topBosses,
  });

  const clues = theme.embed('poll', {
    title: `Clues & pets · ${parsed.displayName}`,
    description: [
      clueLine,
      'Pets are not on the hiscores. Drop a bingo screenshot tile if you want credit.',
      recent.length ? `**Recent flags:** ${recent.slice(0, 8).join(' · ')}` : null,
    ].filter(Boolean).join('\n'),
  });

  const clan = theme.embed('brand', {
    title: `Clan card · ${parsed.displayName}`,
    fields: [
      theme.field('WOM rank', womRole || '—', true),
      theme.field('Discord roles', discordRoles.slice(0, 4).join(', ') || '—', true),
      theme.field('SOTW wins', `${sotwWins.count || 0} · ${dash(sotwWins.xp)} XP`, true),
      theme.field('Raffles', `${raffleWins.count || 0} wins / ${raffleEntries.count || 0} entries`, true),
      theme.field('Masses', `${attendance.yes || 0} going / ${attendance.total || 0} RSVPs`, true),
    ],
  });

  return {
    embeds: [overview, skills, bosses, clues, clan],
    sections: SECTIONS,
    parsed,
  };
}

module.exports = { buildProfile, SECTIONS };
