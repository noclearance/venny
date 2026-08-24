const { getDb } = require('../db/database');
const { prettyMetric, BOSSES } = require('../osrs/catalog');

function metricFromLabel(label) {
  const want = String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  for (const b of BOSSES) {
    const pretty = prettyMetric(b).toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (pretty === want || b.replace(/_/g, '') === want) return b;
  }
  return null;
}

function parseKcRows(gained) {
  return (gained || [])
    .map(row => ({
      name: row.player?.displayName,
      gained: Number(row.data?.gained ?? row.data?.kills?.gained ?? row.data?.kills ?? 0) || 0,
    }))
    .filter(row => row.gained > 0)
    .sort((a, b) => b.gained - a.gained);
}

function formatBoard(rows) {
  const theme = require('./theme');
  const lines = rows.slice(0, 10)
    .map((row, i) => `${theme.medal(i)} **${row.name}** — +${row.gained.toLocaleString()} KC`);
  return lines.join('\n') || 'No KC this BOTW yet.';
}

async function huntRows(settings, botw) {
  if (!settings?.wom_group_id || !botw) return [];
  const wom = require('./wom');
  const gained = await wom.getGroupGainedByDate(
    settings.wom_group_id,
    botw.boss,
    botw.starts_at,
    botw.ends_at,
    15,
  );
  return parseKcRows(gained);
}

async function startBotw({ guildId, channelId, createdBy, boss, durationDays = 7 }) {
  const db = getDb();
  const key = String(boss || '').toLowerCase().replace(/\s+/g, '_');
  if (!BOSSES.includes(key)) {
    return { success: false, error: `Unknown boss \`${boss}\`.` };
  }

  const active = await db.prepare('SELECT * FROM botw WHERE guild_id = ? AND ended = 0 ORDER BY id DESC').get(guildId);
  if (active) {
    return {
      success: false,
      error: `There's already a BOTW (#${active.id}: ${prettyMetric(active.boss)}). \`/boss end\` it first.`,
    };
  }

  const startsAt = new Date().toISOString();
  const endsAt = new Date(Date.now() + durationDays * 86400000).toISOString();
  const result = await db.prepare(`
    INSERT INTO botw (guild_id, boss, starts_at, ends_at, channel_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(guildId, key, startsAt, endsAt, channelId, createdBy);

  const theme = require('./theme');
  const economy = require('./economy');
  const made = await require('./cards').make('danger', {
    job: 'botw_start',
    facts: { boss: prettyMetric(key), days: durationDays },
    extraLines: [
      `KC from this second until ${theme.when(endsAt)} counts on Wise Old Man group gained.`,
      `Board: \`/boss kc\` or \`/boss week\` with no boss name.`,
    ],
    thumbnail: theme.skillIconUrl('slayer'),
    fields: [
      theme.field('Boss', prettyMetric(key), true),
      theme.field('Ends', theme.when(endsAt), true),
      theme.field('Guild credits', economy.payNote('botw_win')),
    ],
    timestamp: true,
  });

  return {
    success: true,
    embed: made.embed,
    card: made.json,
    botwId: result.lastInsertRowid,
    boss: key,
    endsAt,
  };
}

async function kcBoard(settings, botw) {
  if (!settings?.wom_group_id || !botw) return 'Set a WOM group to see KC.';
  try {
    return formatBoard(await huntRows(settings, botw));
  } catch (err) {
    return `WOM: ${err.message}`;
  }
}

async function finalizeBotw(client, botw) {
  const db = getDb();
  if (Number(botw.ended)) return;
  const settings = await db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(botw.guild_id);
  let rows = [];
  try {
    rows = await huntRows(settings, botw);
  } catch (err) {
    console.warn(`BOTW results ${botw.id}: ${err.message}`);
  }

  const winnerRsn = rows[0]?.name || null;
  const board = settings?.wom_group_id
    ? formatBoard(rows)
    : 'Set a WOM group to see KC.';
  const theme = require('./theme');
  const made = await require('./cards').make('danger', {
    job: 'botw_end',
    facts: { boss: prettyMetric(botw.boss), winner: winnerRsn },
    extraLines: [board],
    thumbnail: theme.skillIconUrl('slayer'),
  });

  const channel = await client.channels.fetch(botw.channel_id);
  const posted = await channel.send({ embeds: [made.embed] });
  await require('./cards').publish(client, botw.guild_id, {
    kind: 'danger',
    json: made.json,
    fields: [theme.field('Guild credits', require('./economy').payNote('botw_win'))],
    sourceChannelId: posted.channelId,
    sourceMessageId: posted.id,
  });

  const claimed = await db.prepare('UPDATE botw SET ended = 1 WHERE id = ? AND ended = 0').run(botw.id);
  if (!claimed.changes) return;
  if (winnerRsn) {
    const winner = await db.prepare('SELECT user_id FROM members WHERE guild_id = ? AND lower(rsn) = lower(?)').get(botw.guild_id, winnerRsn);
    if (winner) await require('./economy').award(botw.guild_id, winner.user_id, 'botw_win', client);
  }
}

module.exports = { startBotw, kcBoard, finalizeBotw, metricFromLabel };
