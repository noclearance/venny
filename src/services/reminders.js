// Reminder poller — checks for due events every 60 seconds and posts reminders
const { getDb } = require('../db/database');

const CHECK_INTERVAL = 60_000;
const REMIND_AHEAD_MS = 15 * 60 * 1000;
const REMIND_GRACE_MS = 30 * 60 * 1000;

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
      const mentionStr = await subs.buildMentionString(event.guild_id, category);

      const economy = require('./economy');
      const made = await require('./cards').make('event', {
        job: started ? 'event_now' : 'event_soon',
        facts: { title: event.title, category: event.category || 'general', started },
        fallbackTitle: event.title,
        fallbackDescription: event.description || theme.line(started ? 'eventNow' : 'eventSoon', event.id),
        extraLines: [
          event.description || null,
          theme.when(event.event_time),
          started ? 'It’s up. Get in.' : 'Fifteen minutes. If you’re coming, be logged in.',
        ],
        fields: [theme.field('Guild credits', economy.payNote('event_rsvp'))],
      });
      await channel.send({
        content: mentionStr || undefined,
        embeds: [made.embed],
        allowedMentions: { parse: ['users', 'roles'] },
      });

      await db.prepare('UPDATE events SET reminder_sent = 1 WHERE id = ?').run(event.id);
    } catch (err) {
      console.error(`Failed to send reminder for event ${event.id}:`, err.message);
    }
  }

  const passedRecurring = await db.prepare(`
    SELECT * FROM events
    WHERE next_created = 0
      AND recurrence IN ('weekly', 'monthly')
      AND event_time < ?
  `).all(now);

  for (const event of passedRecurring) {
    try {
      const oldDate = new Date(event.event_time);
      let newDate = new Date(oldDate);

      do {
        if (event.recurrence === 'weekly') {
          newDate.setDate(newDate.getDate() + 7);
        } else {
          newDate.setMonth(newDate.getMonth() + 1);
        }
      } while (newDate.getTime() <= nowMs);

      await db.prepare(`
        INSERT INTO events (guild_id, title, description, event_time, channel_id, created_by, recurrence, parent_event_id, category)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.guild_id,
        event.title,
        event.description,
        newDate.toISOString(),
        event.channel_id,
        event.created_by,
        event.recurrence,
        event.parent_event_id || event.id,
        event.category || 'general'
      );

      await db.prepare('UPDATE events SET next_created = 1 WHERE id = ?').run(event.id);
      console.log(`Created next recurring event for: ${event.title} → ${newDate.toISOString()}`);
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

async function finalizeSotw(client, sotw) {
  const { getDb } = require('../db/database');
  const wom = require('./wom');
  const db = getDb();

  let winnerRsn = null;
  let xpGained = null;

  if (sotw.wom_competition_id) {
    try {
      const details = await wom.getCompetitionDetails(sotw.wom_competition_id);
      const participations = details.participations || [];

      const sorted = participations
        .filter(p => p.progress && p.progress.gained > 0)
        .sort((a, b) => b.progress.gained - a.progress.gained);

      if (sorted.length > 0) {
        winnerRsn = sorted[0].player.displayName;
        xpGained = sorted[0].progress.gained;
      }

      const channel = await client.channels.fetch(sotw.channel_id);
      if (channel) {
        const theme = require('./theme');
        const economy = require('./economy');
        const loot = economy.clipPrize(sotw.prize);
        const top = sorted.slice(0, 5);
        const board = sorted.length
          ? theme.rankLines(top, p => `**${p.player.displayName}** — ${p.progress.gained.toLocaleString()} XP`)
          : 'No XP was gained.';
        const fields = [
          theme.prizeField(economy.prizeLine('sotw_win', loot)),
          winnerRsn ? theme.field('Winner', winnerRsn) : null,
        ];
        const made = require('./cards').venny('sotw', {
          job: 'sotw_end',
          facts: {
            skill: sotw.skill,
            winner: winnerRsn || null,
            xp: xpGained || null,
            placed: sorted.length,
            prize: loot || null,
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
        const posted = await channel.send({
          embeds: [made.embed],
        });
        const cards = require('./cards');
        cards.flavorLater(posted, made.flavor);
        await cards.publish(client, sotw.guild_id, {
          kind: 'sotw',
          json: made.json,
          fields,
          sourceChannelId: posted.channelId,
          sourceMessageId: posted.id,
        });
      }
    } catch (err) {
      console.error('Error fetching SOTW results:', err.message);
    }
  }

  if (winnerRsn) {
    await db.prepare(`
      INSERT INTO sotw_winners (guild_id, sotw_id, skill, winner_rsn, xp_gained, starts_at, ends_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(sotw.guild_id, sotw.id, sotw.skill, winnerRsn, xpGained, sotw.starts_at, sotw.ends_at);
    const winner = await db.prepare('SELECT user_id FROM members WHERE guild_id = ? AND lower(rsn) = lower(?)').get(sotw.guild_id, winnerRsn);
    if (winner) await require('./economy').award(sotw.guild_id, winner.user_id, 'sotw_win', client);
  }

  await db.prepare('UPDATE sotw SET ended = 1, winner_rsn = ? WHERE id = ?').run(winnerRsn, sotw.id);

  try {
    const sotwQueue = require('./sotwQueue');
    await sotwQueue.startNextQueuedSotw(sotw.guild_id, client);
  } catch (err) {
    console.error('Failed to start next queued SOTW:', err.message);
  }
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
  if (started.flavor) cards.flavorLater(posted, started.flavor);
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

  try {
    const channel = await client.channels.fetch(poll.channel_id);
    if (!channel) {
      await db.prepare('UPDATE polls SET finalized = 1, winner = ? WHERE id = ?').run('Channel missing', poll.id);
      return;
    }

    const message = await channel.messages.fetch(poll.message_id);
    if (!message || !message.poll) {
      await db.prepare('UPDATE polls SET finalized = 1, winner = ? WHERE id = ?').run('Poll message missing', poll.id);
      return;
    }

    const answers = message.poll.answers;
    const sorted = [...answers.values()].sort((a, b) => b.voteCount - a.voteCount);

    if (sorted.length === 0 || sorted[0].voteCount === 0) {
      await db.prepare('UPDATE polls SET finalized = 1, winner = ? WHERE id = ?').run('No votes', poll.id);
      await channel.send(`📊 **Poll ended:** ${poll.question}\n\nNo votes were cast.`);
      return;
    }

    const winner = sorted[0].text;
    await db.prepare('UPDATE polls SET finalized = 1, winner = ? WHERE id = ?').run(winner, poll.id);

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
      await db.prepare('UPDATE polls SET finalized = 1, winner = ? WHERE id = ?').run('Unavailable', poll.id);
    }
    console.error(`Failed to finalize poll ${poll.id}:`, err.message);
  }
}

module.exports = { startReminderPoller, finalizeSotw, finalizePoll };
