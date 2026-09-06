// Reminder poller — checks for due events every 60 seconds and posts reminders
const { getDb } = require('../db/database');
const { resolveConfiguredChannel } = require('./channelRouting');

const CHECK_INTERVAL = 60_000;
const REMIND_AHEAD_MS = 15 * 60 * 1000;
const REMIND_GRACE_MS = 30 * 60 * 1000;
const SOTW_ENDING_SOON_MS = 24 * 60 * 60 * 1000;

function startReminderPoller(client) {
  let running = false;
  const run = () => {
    if (running) {
      console.warn('Reminder tick still running; skipping this interval');
      return;
    }
    running = true;
    tick(client)
      .catch(err => {
        console.error('Reminder poller tick failed:', err.message);
      })
      .finally(() => {
        running = false;
      });
  };

  setInterval(run, CHECK_INTERVAL);
  run();
}

async function tick(client) {
  const db = getDb();
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const soon = new Date(nowMs + REMIND_AHEAD_MS).toISOString();
  const grace = new Date(nowMs - REMIND_GRACE_MS).toISOString();

  // Events in the next 15 minutes, plus anything missed in the last 30 minutes
  const dueEvents = await db.prepare(`
    SELECT * FROM events
    WHERE reminder_sent = 0 AND event_time <= ? AND event_time >= ?
    ORDER BY event_time ASC
  `).all(soon, grace);

  for (const event of dueEvents) {
    try {
      const channel = await client.channels.fetch(event.channel_id);
      if (!channel) {
        await db.prepare('UPDATE events SET reminder_sent = 1 WHERE id = ?').run(event.id);
        continue;
      }

      if (event.category === 'sotw') {
        await db.prepare('UPDATE events SET reminder_sent = 1 WHERE id = ?').run(event.id);
        continue;
      }

      const eventTime = new Date(event.event_time);
      const started = eventTime.getTime() <= nowMs;
      const theme = require('./theme');
      const subs = require('./subscriptions');
      const category = event.category || 'general';
      const ping = await subs.mentionFor({
        guildId: event.guild_id,
        category,
        mode: event.ping_mode,
        roleId: event.ping_role_id,
        forReminder: true,
      });

      const claimed = await db.prepare('UPDATE events SET reminder_sent = 1 WHERE id = ? AND reminder_sent = 0').run(event.id);
      if (!claimed.changes) continue;

      const economy = require('./economy');
      const job = started ? 'event_now' : 'event_soon';
      const pingCopy = ping;
      const channelCopy = channel;
      const extraLines = [
        event.description || null,
        theme.when(event.event_time),
        started ? 'It’s up. Get in.' : 'Fifteen minutes. If you’re coming, be logged in.',
      ];
      const fields = [theme.field('Guild credits', economy.payNote('event_rsvp'))];
      require('./cards').make('event', {
        job,
        facts: { title: event.title, category: event.category || 'general', started, seed: `${event.id}-${job}` },
        fallbackTitle: event.title,
        fallbackDescription: event.description || theme.line(job === 'event_now' ? 'eventNow' : 'eventSoon', event.id),
        extraLines,
        fields,
      }).then(made => channelCopy.send({
        content: pingCopy.content,
        embeds: [made.embed],
        allowedMentions: pingCopy.allowedMentions,
      })).catch(err => {
        console.error(`Failed to send reminder for event ${event.id}:`, err.message);
      });
    } catch (err) {
      console.error(`Failed to send reminder for event ${event.id}:`, err.message);
    }
  }

  try {
    await sendSotwCadenceReminders(client, nowMs);
  } catch (err) {
    console.error('SOTW cadence reminders failed:', err.message);
  }

  const passedRecurring = await db.prepare(`
    SELECT * FROM events
    WHERE next_created = 0
      AND recurrence IN ('weekly', 'monthly')
      AND event_time < ?
  `).all(now);

  for (const event of passedRecurring) {
    try {
      const claimed = await db.prepare('UPDATE events SET next_created = 1 WHERE id = ? AND next_created = 0').run(event.id);
      if (!claimed.changes) continue;

      const { DateTime } = require('luxon');
      const tz = await require('./timezone').getGuildTimezone(event.guild_id);
      let next = DateTime.fromISO(event.event_time, { setZone: true }).setZone(tz);
      if (!next.isValid) next = DateTime.fromISO(event.event_time, { zone: tz });
      do {
        next = event.recurrence === 'weekly' ? next.plus({ weeks: 1 }) : next.plus({ months: 1 });
      } while (next.toMillis() <= nowMs);
      const newIso = next.toUTC().toISO();

      try {
        await db.prepare(`
          INSERT INTO events (guild_id, title, description, event_time, channel_id, created_by, recurrence, parent_event_id, category, ping_mode, ping_role_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          event.guild_id,
          event.title,
          event.description,
          newIso,
          event.channel_id,
          event.created_by,
          event.recurrence,
          event.parent_event_id || event.id,
          event.category || 'general',
          event.ping_mode || 'category',
          event.ping_role_id || null,
        );
      } catch (err) {
        await db.prepare('UPDATE events SET next_created = 0 WHERE id = ?').run(event.id);
        throw err;
      }

      console.log(`Created next recurring event for: ${event.title} → ${newIso}`);
    } catch (err) {
      console.error(`Failed to create recurring event for ${event.id}:`, err.message);
    }
  }

  const endedSotw = await db.prepare(`
    SELECT * FROM sotw
    WHERE ended = 0 AND ends_at <= ?
  `).all(now);

  for (const sotw of endedSotw) {
    try {
      await finalizeSotw(client, sotw);
    } catch (err) {
      console.error(`Failed to finalize SOTW ${sotw.id}:`, err.message);
    }
  }

  const endedPolls = await db.prepare(`
    SELECT * FROM polls
    WHERE finalized = 0 AND ends_at <= ?
  `).all(now);

  for (const poll of endedPolls) {
    try {
      await finalizePoll(client, poll);
    } catch (err) {
      console.error(`Failed to finalize poll ${poll.id}:`, err.message);
    }
  }

  try {
    const { tickTracker } = require('./tracker');
    await tickTracker(client);
  } catch (err) {
    console.error('Tracker tick failed:', err.message);
  }

  const endedBotw = await db.prepare('SELECT * FROM botw WHERE ended = 0 AND ends_at <= ?').all(now);
  for (const row of endedBotw) {
    try {
      await require('./botw').finalizeBotw(client, row);
    } catch (err) {
      console.error(`Failed to finalize BOTW ${row.id}:`, err.message);
      if (isMissingDiscordResource(err)) {
        await db.prepare('UPDATE botw SET ended = 1 WHERE id = ?').run(row.id);
      }
    }
  }

  try {
    await require('./raffleRun').expireDue(client);
  } catch (err) {
    console.error('Raffle expire tick failed:', err.message);
  }
}

function sotwWindow(sotw) {
  const startMs = new Date(sotw?.starts_at || 0).getTime();
  const endMs = new Date(sotw?.ends_at || 0).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return {
    startMs,
    endMs,
    midpointMs: startMs + Math.floor((endMs - startMs) / 2),
  };
}

function shouldSendMidweekReminder(sotw, nowMs = Date.now()) {
  if (Number(sotw?.midweek_reminder_sent || 0)) return false;
  const window = sotwWindow(sotw);
  if (!window) return false;
  return nowMs >= window.midpointMs && nowMs < window.endMs;
}

function shouldSendEndingSoonReminder(sotw, nowMs = Date.now(), leadMs = SOTW_ENDING_SOON_MS) {
  if (Number(sotw?.ending_soon_reminder_sent || 0)) return false;
  const window = sotwWindow(sotw);
  if (!window) return false;
  return nowMs >= (window.endMs - leadMs) && nowMs < window.endMs;
}

async function resolveSotwReminderChannel(client, sotw) {
  const route = await resolveConfiguredChannel(client, sotw.guild_id, {
    slots: ['reminder_channel'],
    allowFallback: false,
  });
  if (route?.channel) return route.channel;
  if (!sotw.channel_id) return null;
  try {
    return await client.channels.fetch(sotw.channel_id);
  } catch {
    return null;
  }
}

async function fetchSotwStandingsSnapshot(sotw, limit = 5) {
  const theme = require('./theme');
  if (!sotw.wom_competition_id) {
    return {
      onBoard: 0,
      rows: [],
      url: null,
      preview: 'Local SOTW is live in Discord only. A mod can run `/sotw update` to attach WOM standings.',
    };
  }

  const url = `https://wiseoldman.net/competitions/${sotw.wom_competition_id}`;
  try {
    const wom = require('./wom');
    const details = await wom.getCompetitionDetails(sotw.wom_competition_id);
    const rows = (details.participations || [])
      .filter(p => p.progress && p.progress.gained > 0)
      .sort((a, b) => b.progress.gained - a.progress.gained);
    const top = rows.slice(0, limit);
    return {
      onBoard: rows.length,
      rows,
      url,
      preview: rows.length
        ? theme.rankLines(top, p => `**${p.player.displayName}** — ${p.progress.gained.toLocaleString()} XP`)
        : 'No XP gains on the board yet.',
    };
  } catch (err) {
    return {
      onBoard: 0,
      rows: [],
      url,
      preview: 'Could not refresh WOM standings right now. Keep grinding and try `/sotw standings`.',
      error: err.message,
    };
  }
}

async function postSotwMidweekReminder(client, sotw) {
  const channel = await resolveSotwReminderChannel(client, sotw);
  if (!channel) return false;
  const subs = require('./subscriptions');
  const ping = await subs.mentionFor({
    guildId: sotw.guild_id,
    category: 'sotw',
    mode: 'category',
    forReminder: true,
  });
  const snapshot = await fetchSotwStandingsSnapshot(sotw, 5);
  const endTs = Math.floor(new Date(sotw.ends_at).getTime() / 1000);
  const theme = require('./theme');
  const cards = require('./cards');
  const made = cards.venny('sotw', {
    job: 'sotw_standings',
    facts: { skill: sotw.skill, onBoard: snapshot.onBoard, checkpoint: 'midweek' },
    fallbackTitle: `${sotw.skill} SOTW — mid-week standings`,
    fallbackDescription: 'Halfway check-in for the active week.',
    extraLines: [
      snapshot.preview,
      'Halfway mark reached. Keep grinding before the final stretch.',
    ],
    thumbnail: theme.skillIconUrl(sotw.skill),
    url: snapshot.url || undefined,
    fields: [
      theme.field('Ends', `<t:${endTs}:R>`, true),
      theme.field('On the board', String(snapshot.onBoard), true),
    ],
  });
  const posted = await channel.send({
    content: ping.content || undefined,
    embeds: [made.embed],
    allowedMentions: ping.allowedMentions,
  });
  cards.flavorLater(posted, made.flavor);
  return true;
}

async function postSotwEndingSoonReminder(client, sotw) {
  const channel = await resolveSotwReminderChannel(client, sotw);
  if (!channel) return false;
  const subs = require('./subscriptions');
  const ping = await subs.mentionFor({
    guildId: sotw.guild_id,
    category: 'sotw',
    mode: 'category',
    forReminder: true,
  });
  const snapshot = await fetchSotwStandingsSnapshot(sotw, 3);
  const endTs = Math.floor(new Date(sotw.ends_at).getTime() / 1000);
  const theme = require('./theme');
  const leader = snapshot.rows[0]
    ? `Current leader: **${snapshot.rows[0].player.displayName}** — ${snapshot.rows[0].progress.gained.toLocaleString()} XP.`
    : 'Board is still open — final push starts now.';
  const cards = require('./cards');
  const made = cards.venny('sotw', {
    job: 'sotw_standings',
    facts: { skill: sotw.skill, onBoard: snapshot.onBoard, checkpoint: 'ending_soon' },
    fallbackTitle: `${sotw.skill} SOTW — ending soon`,
    fallbackDescription: '24 hours left in the active SOTW window.',
    extraLines: [
      leader,
      snapshot.preview,
      'Update hiscores and lock in your final grind before the week closes.',
    ],
    thumbnail: theme.skillIconUrl(sotw.skill),
    url: snapshot.url || undefined,
    fields: [theme.field('Ends', `<t:${endTs}:R>`, true)],
  });
  const posted = await channel.send({
    content: ping.content || undefined,
    embeds: [made.embed],
    allowedMentions: ping.allowedMentions,
  });
  cards.flavorLater(posted, made.flavor);
  return true;
}

async function sendSotwCadenceReminders(client, nowMs = Date.now()) {
  const db = getDb();
  const now = new Date(nowMs).toISOString();
  const active = await db.prepare(`
    SELECT * FROM sotw
    WHERE ended = 0
      AND starts_at <= ?
      AND ends_at > ?
      AND (
        COALESCE(midweek_reminder_sent, 0) = 0
        OR COALESCE(ending_soon_reminder_sent, 0) = 0
      )
    ORDER BY id ASC
  `).all(now, now);

  for (const sotw of active) {
    if (shouldSendMidweekReminder(sotw, nowMs)) {
      try {
        const sent = await postSotwMidweekReminder(client, sotw);
        if (sent) await db.prepare('UPDATE sotw SET midweek_reminder_sent = 1 WHERE id = ?').run(sotw.id);
      } catch (err) {
        console.error(`SOTW #${sotw.id} mid-week reminder failed:`, err.message);
      }
    }

    if (shouldSendEndingSoonReminder(sotw, nowMs, SOTW_ENDING_SOON_MS)) {
      try {
        const sent = await postSotwEndingSoonReminder(client, sotw);
        if (sent) await db.prepare('UPDATE sotw SET ending_soon_reminder_sent = 1 WHERE id = ?').run(sotw.id);
      } catch (err) {
        console.error(`SOTW #${sotw.id} ending-soon reminder failed:`, err.message);
      }
    }
  }
}

async function finalizeSotw(client, sotw) {
  const { getDb } = require('../db/database');
  const wom = require('./wom');
  const db = getDb();

  const claimed = await db.prepare(
    'UPDATE sotw SET ended = 1, finalize_error = NULL WHERE id = ? AND ended = 0',
  ).run(sotw.id);
  if (!claimed.changes) return { skipped: true };

  let winnerRsn = null;
  let xpGained = null;
  let sorted = [];

  if (sotw.wom_competition_id) {
    try {
      const details = await wom.getCompetitionDetails(sotw.wom_competition_id);
      const participations = details.participations || [];
      sorted = participations
        .filter(p => p.progress && p.progress.gained > 0)
        .sort((a, b) => b.progress.gained - a.progress.gained);
      if (sorted.length > 0) {
        winnerRsn = sorted[0].player.displayName;
        xpGained = sorted[0].progress.gained;
      }
    } catch (err) {
      console.error('Error fetching SOTW results:', err.message);
      await db.prepare('UPDATE sotw SET ended = 0, finalize_error = ? WHERE id = ?')
        .run(String(err.message).slice(0, 300), sotw.id);
      return { retry: true, error: err.message };
    }
  }

  try {
    const channel = await client.channels.fetch(sotw.channel_id);
    if (channel) {
      const theme = require('./theme');
      const economy = require('./economy');
      const loot = economy.clipPrize(sotw.prize);
      const top = sorted.slice(0, 5);
      const board = sorted.length
        ? theme.rankLines(top, p => `**${p.player.displayName}** — ${p.progress.gained.toLocaleString()} XP`)
        : (sotw.wom_competition_id ? 'No XP was gained.' : 'Discord week — no WOM board.');
      const fields = [
        theme.prizeField(economy.prizeLine('sotw_win', loot)),
        winnerRsn ? theme.field('Winner', winnerRsn) : null,
      ];
      const cards = require('./cards');
      const made = await cards.make('sotw', {
        job: 'sotw_end',
        facts: {
          skill: sotw.skill,
          winner: winnerRsn || null,
          xp: xpGained || null,
          placed: sorted.length,
          prize: loot || null,
          seed: sotw.id,
        },
        fallbackTitle: `${sotw.skill} SOTW — results`,
        fallbackDescription: theme.line('sotwEnded', sotw.id),
        extraLines: [board],
        thumbnail: theme.skillIconUrl(sotw.skill),
        url: sotw.wom_competition_id
          ? `https://wiseoldman.net/competitions/${sotw.wom_competition_id}`
          : undefined,
        fields,
      });
      const posted = await channel.send({ embeds: [made.embed] });
      await cards.publish(client, sotw.guild_id, {
        kind: 'sotw',
        json: made.json,
        fields,
        sourceChannelId: posted.channelId,
        sourceMessageId: posted.id,
      });
    }
  } catch (err) {
    console.error(`SOTW #${sotw.id} result post:`, err.message);
  }

  if (winnerRsn) {
    try {
      await db.prepare(`
        INSERT INTO sotw_winners (guild_id, sotw_id, skill, winner_rsn, xp_gained, starts_at, ends_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(sotw_id) DO NOTHING
      `).run(sotw.guild_id, sotw.id, sotw.skill, winnerRsn, xpGained, sotw.starts_at, sotw.ends_at);
    } catch (err) {
      if (!/UNIQUE|duplicate key/i.test(err.message || '')) throw err;
    }
    const winner = await db.prepare('SELECT user_id FROM members WHERE guild_id = ? AND lower(rsn) = lower(?)').get(sotw.guild_id, winnerRsn);
    if (winner) {
      await require('./economy').award(sotw.guild_id, winner.user_id, 'sotw_win', client, sotw.id);
      require('./ranks').maybePromote(client, sotw.guild_id, winner.user_id);
    }
  }

  await db.prepare('UPDATE sotw SET winner_rsn = ? WHERE id = ?').run(winnerRsn, sotw.id);

  try {
    const sotwQueue = require('./sotwQueue');
    await sotwQueue.startNextQueuedSotw(sotw.guild_id, client);
  } catch (err) {
    console.error('Failed to start next queued SOTW:', err.message);
  }
  return { ok: true, winnerRsn };
}

function pollDays(poll) {
  return Number(poll.duration_days || poll.sotw_duration || 7);
}

async function publishAutoStart(client, channel, poll, winner, results, { label, liveLine, kind, started, extraLines = [] }) {
  if (!started.success) {
    await channel.send(`${results}\n\nFailed to auto-start ${label}: ${started.error}`);
    return true;
  }
  const posted = await channel.send(started.embed
    ? { content: `${results}\n\n**${winner}** won. ${liveLine}`, embeds: [started.embed] }
    : { content: `${results}\n\n${started.response}` });
  const cards = require('./cards');
  if (started.card) {
    await cards.publish(client, poll.guild_id, {
      kind,
      json: started.card,
      extraLines,
      fields: started.flavor?.fields,
      sourceChannelId: posted.channelId,
      sourceMessageId: posted.id,
    });
  }
  return true;
}

async function autoStartFromPoll(client, channel, poll, winner, results) {
  if (!poll.auto_start) return false;
  const days = pollDays(poll);

  if (poll.type === 'sotw') {
    const skillMatch = winner.replace(/^[^\s]+\s/, '').toLowerCase().trim();
    const started = await require('./sotw').startSotw({
      guildId: poll.guild_id,
      channelId: poll.channel_id,
      createdBy: poll.created_by,
      skill: skillMatch,
      durationDays: days,
      title: `SOTW: ${skillMatch.toUpperCase()} (Voted)`,
    });
    return publishAutoStart(client, channel, poll, winner, results, {
      label: 'SOTW',
      liveLine: 'Week is live.',
      kind: 'sotw',
      started,
      extraLines: started.tracking ? [started.tracking] : [],
    });
  }

  if (poll.type === 'botw') {
    const { startBotw, metricFromLabel } = require('./botw');
    const started = await startBotw({
      guildId: poll.guild_id,
      channelId: poll.channel_id,
      createdBy: poll.created_by,
      boss: metricFromLabel(winner) || winner,
      durationDays: days,
    });
    return publishAutoStart(client, channel, poll, winner, results, {
      label: 'BOTW',
      liveLine: 'Hunt is live.',
      kind: 'danger',
      started,
    });
  }

  return false;
}

function isMissingDiscordResource(err) {
  const code = err.code || err.status;
  if (code === 10008 || code === 10003 || code === 50001) return true;
  const msg = err.message || '';
  return /Unknown Message|Unknown Channel|Missing Access/i.test(msg);
}

async function finalizePoll(client, poll) {
  const db = getDb();
  const claimed = await db.prepare('UPDATE polls SET finalized = 1 WHERE id = ? AND finalized = 0').run(poll.id);
  if (!claimed.changes) return;

  try {
    const channel = await client.channels.fetch(poll.channel_id);
    if (!channel) {
      await db.prepare('UPDATE polls SET winner = ? WHERE id = ?').run('Channel missing', poll.id);
      return;
    }

    const message = await channel.messages.fetch(poll.message_id);
    if (!message || !message.poll) {
      await db.prepare('UPDATE polls SET winner = ? WHERE id = ?').run('Poll message missing', poll.id);
      return;
    }

    const answers = message.poll.answers;
    const sorted = [...answers.values()].sort((a, b) => b.voteCount - a.voteCount);

    if (sorted.length === 0 || sorted[0].voteCount === 0) {
      await db.prepare('UPDATE polls SET winner = ? WHERE id = ?').run('No votes', poll.id);
      await channel.send(`📊 **Poll ended:** ${poll.question}\n\nNo votes were cast.`);
      return;
    }

    const winner = sorted[0].text;
    await db.prepare('UPDATE polls SET winner = ? WHERE id = ?').run(winner, poll.id);

    let results = `📊 **Poll Ended: ${poll.question}**\n\n`;
    const medals = ['🥇', '🥈', '🥉'];
    sorted.forEach((answer, i) => {
      const medal = medals[i] || `${i + 1}.`;
      results += `${medal} ${answer.text} — **${answer.voteCount} votes**\n`;
    });

    const topVotes = sorted[0].voteCount;
    const tied = sorted.filter(a => a.voteCount === topVotes);
    if (tied.length > 1) {
      results += `\n⚠️ Tie detected between ${tied.length} options. Using the first one: **${winner}**`;
    }

    const started = await autoStartFromPoll(client, channel, poll, winner, results);
    if (started) return;
    await channel.send(results);
  } catch (err) {
    if (isMissingDiscordResource(err)) {
      await db.prepare('UPDATE polls SET winner = ? WHERE id = ?').run('Unavailable', poll.id);
    } else {
      await db.prepare('UPDATE polls SET finalized = 0 WHERE id = ? AND winner IS NULL').run(poll.id);
    }
    console.error(`Failed to finalize poll ${poll.id}:`, err.message);
  }
}

module.exports = {
  startReminderPoller,
  finalizeSotw,
  finalizePoll,
  sotwWindow,
  shouldSendMidweekReminder,
  shouldSendEndingSoonReminder,
};
