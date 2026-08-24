const { getDb } = require('../db/database');

async function pickWinner(raffle, entries) {
  const db = getDb();
  if (!entries.length) return { winner: null, weightInfo: '' };

  if (!raffle.weight_mode || raffle.weight_mode === 'none') {
    return {
      winner: entries[Math.floor(Math.random() * entries.length)],
      weightInfo: '',
    };
  }

  const weights = [];
  for (const entry of entries) {
    let weight = 1;
    let reason = 'base';

    if (raffle.weight_mode === 'sotw' || raffle.weight_mode === 'activity') {
      const sotwCount = await db.prepare(`
        SELECT COUNT(*) as count FROM sotw_winners
        WHERE guild_id = ? AND winner_rsn IN (
          SELECT rsn FROM members WHERE guild_id = ? AND user_id = ?
        )
      `).get(raffle.guild_id, raffle.guild_id, entry.user_id);
      const sotwWins = sotwCount?.count || 0;
      weight += Math.min(sotwWins, 5);
      if (sotwWins > 0) reason = `${sotwWins} SOTW wins`;
    }

    if (raffle.weight_mode === 'attendance' || raffle.weight_mode === 'activity') {
      const attendanceCount = await db.prepare(`
        SELECT COUNT(*) as count
        FROM event_attendance ea
        JOIN events e ON e.id = ea.event_id
        WHERE ea.user_id = ? AND ea.status = ? AND e.guild_id = ?
      `).get(entry.user_id, 'yes', raffle.guild_id);
      const att = attendanceCount?.count || 0;
      weight += Math.min(att, 5);
      if (att > 0) reason += (reason !== 'base' ? ', ' : '') + `${att} events attended`;
    }

    weights.push({ ...entry, weight: Math.min(weight, 10), reason });
  }

  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
  let random = Math.random() * totalWeight;
  let winner = weights[0];
  for (const w of weights) {
    random -= w.weight;
    if (random <= 0) {
      winner = w;
      break;
    }
  }
  return {
    winner,
    weightInfo: `Weighted by **${raffle.weight_mode}** — winner had weight ${winner.weight} (${winner.reason}) out of ${totalWeight} total`,
  };
}

async function postResult(client, raffle, { winner, entries, weightInfo, outcome }) {
  const theme = require('./theme');
  const prize = raffle.description && raffle.description !== 'Click the button below to enter!'
    ? raffle.description
    : null;
  const closed = outcome === 'empty' || outcome === 'close';
  const made = await require('./cards').make('raffle', {
    job: closed ? 'raffle_end' : 'raffle_win',
    facts: { title: raffle.title, prize, entries: entries.length, auto: true },
    fallbackTitle: closed ? `${raffle.title} — closed` : `${raffle.title} — drawn`,
    fallbackDescription: outcome === 'close'
      ? 'No winner. The Enter button is dead.'
      : outcome === 'empty'
        ? 'Time is up. Nobody entered.'
        : theme.line('raffleWon', raffle.id),
    fields: closed
      ? [theme.field('Entries', String(entries.length), true)]
      : [
          theme.field('Winner', `<@${winner.user_id}>`, true),
          theme.field('Entries', String(entries.length), true),
          prize ? theme.field('Prize', prize) : null,
          weightInfo ? theme.field('Odds', weightInfo) : null,
        ],
    footer: `Raffle #${raffle.id}  ·  Misclickers`,
    timestamp: true,
  });

  let posted = null;
  try {
    const channel = await client.channels.fetch(raffle.channel_id);
    posted = await channel.send({
      content: winner ? `<@${winner.user_id}>` : undefined,
      allowedMentions: winner ? { users: [winner.user_id] } : { parse: [] },
      embeds: [made.embed],
    });
  } catch (err) {
    console.warn(`Raffle #${raffle.id} post failed: ${err.message}`);
  }

  await require('./cards').publish(client, raffle.guild_id, {
    kind: 'raffle',
    json: made.json,
    fields: winner
      ? [
          theme.field('Winner', `<@${winner.user_id}>`),
          theme.field('Guild credits', require('./economy').payNote('raffle_win')),
        ]
      : null,
    sourceChannelId: posted?.channelId,
    sourceMessageId: posted?.id,
    mention: winner ? `<@${winner.user_id}>` : undefined,
  });
  return made;
}

async function markDrawn(raffleId, winnerId) {
  const db = getDb();
  return db.prepare('UPDATE raffles SET drawn = 1, winner_id = ? WHERE id = ? AND drawn = 0')
    .run(winnerId, raffleId);
}

async function settle(client, raffle, { mode = 'draw' } = {}) {
  const db = getDb();
  if (Number(raffle.drawn)) return { skipped: true };

  if (mode === 'close') {
    const marked = await markDrawn(raffle.id, null);
    if (!marked.changes) return { skipped: true };
    const entries = await db.prepare('SELECT * FROM raffle_entries WHERE raffle_id = ?').all(raffle.id);
    await postResult(client, raffle, { winner: null, entries, weightInfo: '', outcome: 'close' });
    return { closed: true, entries };
  }

  const entries = await db.prepare('SELECT * FROM raffle_entries WHERE raffle_id = ?').all(raffle.id);
  if (!entries.length) {
    const marked = await markDrawn(raffle.id, null);
    if (!marked.changes) return { skipped: true };
    await postResult(client, raffle, { winner: null, entries, weightInfo: '', outcome: 'empty' });
    return { empty: true };
  }

  const { winner, weightInfo } = await pickWinner(raffle, entries);
  const marked = await markDrawn(raffle.id, winner.user_id);
  if (!marked.changes) return { skipped: true };
  await require('./economy').award(raffle.guild_id, winner.user_id, 'raffle_win', client);
  const made = await postResult(client, raffle, { winner, entries, weightInfo, outcome: 'win' });
  return { winner, entries, weightInfo, made };
}

async function expireDue(client) {
  const db = getDb();
  const now = new Date().toISOString();
  const due = await db.prepare(`
    SELECT * FROM raffles
    WHERE drawn = 0 AND ends_at IS NOT NULL AND ends_at <= ?
    ORDER BY id ASC
  `).all(now);
  for (const raffle of due) {
    try {
      await settle(client, raffle);
      console.log(`Raffle #${raffle.id} auto-settled`);
    } catch (err) {
      console.error(`Raffle #${raffle.id} auto-settle failed: ${err.message}`);
    }
  }
}

function stillOpen(raffle) {
  if (!raffle || Number(raffle.drawn)) return false;
  if (!raffle.ends_at) return true;
  return new Date(raffle.ends_at).getTime() > Date.now();
}

module.exports = { pickWinner, settle, expireDue, stillOpen };
