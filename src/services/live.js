const { getDb } = require('../db/database');
const theme = require('./theme');
const bingo = require('./bingo');
const wom = require('./wom');

function pin(guildId, kind, refId, channelId, messageId) {
  getDb().prepare(`
    INSERT INTO live_embeds (guild_id, kind, ref_id, channel_id, message_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, kind, ref_id) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id
  `).run(guildId, kind, String(refId || '0'), channelId, messageId);
}

function drop(row, reason) {
  getDb().prepare('DELETE FROM live_embeds WHERE id = ?').run(row.id);
  console.warn(`Stopped updating ${row.kind} — ${reason}. Run the command again in a channel the bot can post in.`);
}

function isDead(err) {
  const code = err.code || err.status;
  if ([50001, 50013, 10003, 10008, 10004].includes(code)) return true;
  return /Missing Access|Unknown Message|Unknown Channel|Missing Permissions/i.test(err.message || '');
}

async function refreshBingo(client, row) {
  const event = bingo.getBingo(row.guild_id, Number(row.ref_id));
  if (!event || event.status === 'ended' || event.status === 'archived') {
    drop(row, 'board is closed');
    return;
  }
  const channel = await client.channels.fetch(row.channel_id);
  const message = await channel.messages.fetch(row.message_id);
  const draft = require('./bingoDraft');
  await message.edit(draft.livePayload(event));
}

async function refreshKind(client, guildId, kind, refId) {
  const row = getDb().prepare('SELECT * FROM live_embeds WHERE guild_id = ? AND kind = ? AND ref_id = ?')
    .get(guildId, kind, String(refId));
  if (!row) return;
  try {
    if (kind === 'bingo') await refreshBingo(client, row);
  } catch (err) {
    if (isDead(err)) drop(row, err.message);
    else console.error(`Live embed ${row.kind}#${row.ref_id} failed:`, err.message);
  }
}

async function refreshSotw(client, row) {
  const db = getDb();
  const sotw = db.prepare('SELECT * FROM sotw WHERE id = ? AND guild_id = ? AND ended = 0').get(Number(row.ref_id), row.guild_id);
  if (!sotw?.wom_competition_id) {
    drop(row, 'SOTW ended');
    return;
  }
  const details = await wom.getCompetitionDetails(sotw.wom_competition_id);
  const top = (details.participations || [])
    .filter(p => p.progress && p.progress.gained > 0)
    .sort((a, b) => b.progress.gained - a.progress.gained)
    .slice(0, 10);
  const channel = await client.channels.fetch(row.channel_id);
  const message = await channel.messages.fetch(row.message_id);
  await message.edit({
    embeds: [theme.embed('sotw', {
      title: `${sotw.skill} SOTW`,
      description: theme.rankLines(top, p => `**${p.player.displayName}** — ${p.progress.gained.toLocaleString()} XP`),
      thumbnail: theme.skillIconUrl(sotw.skill),
      url: `https://wiseoldman.net/competitions/${sotw.wom_competition_id}`,
      fields: [theme.field('Ends', theme.when(sotw.ends_at), true)],
    })],
  });
}

async function refreshDashboard(client, row) {
  const channel = await client.channels.fetch(row.channel_id);
  const message = await channel.messages.fetch(row.message_id);
  const db = getDb();
  const now = new Date().toISOString();
  const sotw = db.prepare('SELECT * FROM sotw WHERE guild_id = ? AND ended = 0 ORDER BY id DESC').get(row.guild_id);
  const event = db.prepare('SELECT * FROM events WHERE guild_id = ? AND event_time > ? ORDER BY event_time ASC').get(row.guild_id, now);
  const raffle = db.prepare('SELECT * FROM raffles WHERE guild_id = ? AND drawn = 0 ORDER BY id DESC').get(row.guild_id);
  const card = bingo.activeBingo(row.guild_id);
  await message.edit({
    embeds: [theme.embed('brand', {
      title: 'Clan dashboard',
      description: [
        sotw ? `**SOTW** — ${sotw.skill} · ${theme.when(sotw.ends_at)}` : '**SOTW** — none',
        event ? `**Next mass** — ${event.title} · ${theme.when(event.event_time)}` : '**Next mass** — none',
        raffle ? `**Raffle** — ${raffle.title}` : '**Raffle** — none',
        card ? `**Bingo** — ${card.title} (${card.status})` : '**Bingo** — none',
      ].join('\n'),
      thumbnail: sotw ? theme.skillIconUrl(sotw.skill) : theme.VENNY.icon,
    })],
  });
}

async function refreshAll(client) {
  const rows = getDb().prepare('SELECT * FROM live_embeds').all();
  for (const row of rows) {
    try {
      if (row.kind === 'bingo') await refreshBingo(client, row);
      else if (row.kind === 'sotw') await refreshSotw(client, row);
      else if (row.kind === 'dashboard') await refreshDashboard(client, row);
    } catch (err) {
      if (isDead(err)) drop(row, err.message);
      else console.error(`Live embed ${row.kind}#${row.ref_id} failed:`, err.message);
    }
  }
}

module.exports = { pin, refreshAll, refreshKind };
