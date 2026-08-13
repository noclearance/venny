// Reminder poller — checks for due events every 60 seconds and posts reminders
const { getDb } = require('../db/database');

const CHECK_INTERVAL = 60_000;
const REMIND_AHEAD_MS = 15 * 60 * 1000;
const REMIND_GRACE_MS = 30 * 60 * 1000;

function startReminderPoller(client) {
  setInterval(() => tick(client).catch(err => {
    console.error('Reminder poller tick failed:', err.message);
  }), CHECK_INTERVAL);

  // Catch up immediately on boot so downtime does not skip due work
  tick(client).catch(err => {
    console.error('Reminder poller startup tick failed:', err.message);
  });
}

async function tick(client) {
  const db = getDb();
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const soon = new Date(nowMs + REMIND_AHEAD_MS).toISOString();
  const grace = new Date(nowMs - REMIND_GRACE_MS).toISOString();

  // Events in the next 15 minutes, plus anything missed in the last 30 minutes
  const dueEvents = db.prepare(`
    SELECT * FROM events
    WHERE reminder_sent = 0 AND event_time <= ? AND event_time >= ?
    ORDER BY event_time ASC
  `).all(soon, grace);

  for (const event of dueEvents) {
    try {
      const channel = await client.channels.fetch(event.channel_id);
      if (!channel) {
        db.prepare('UPDATE events SET reminder_sent = 1 WHERE id = ?').run(event.id);
        continue;
      }

      const eventTime = new Date(event.event_time);
      const started = eventTime.getTime() <= nowMs;
      const theme = require('./theme');
      const subs = require('./subscriptions');
      const category = event.category || 'general';
      const mentionStr = subs.buildMentionString(event.guild_id, category);

      const economy = require('./economy');
      await channel.send({
        content: mentionStr || undefined,
        embeds: [theme.embed('event', {
          title: event.title,
          description: [
            event.description || theme.line(started ? 'eventNow' : 'eventSoon', event.id),
            theme.when(event.event_time),
            started ? 'It’s up. Get in.' : 'Fifteen minutes. If you’re coming, be logged in.',
          ].join('\n\n'),
          fields: event.category === 'sotw'
            ? [theme.field('Credits', economy.payNote('sotw_win'))]
            : [theme.field('Credits', economy.payNote('event_rsvp'))],
        })],
        allowedMentions: { parse: ['users', 'roles'] },
      });

      db.prepare('UPDATE events SET reminder_sent = 1 WHERE id = ?').run(event.id);
    } catch (err) {
      console.error(`Failed to send reminder for event ${event.id}:`, err.message);
    }
  }

  const passedRecurring = db.prepare(`
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

      db.prepare(`
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

      db.prepare('UPDATE events SET next_created = 1 WHERE id = ?').run(event.id);
      console.log(`Created next recurring event for: ${event.title} → ${newDate.toISOString()}`);
    } catch (err) {
      console.error(`Failed to create recurring event for ${event.id}:`, err.message);
    }
  }

  const endedSotw = db.prepare(`
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

  const endedPolls = db.prepare(`
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

  db.prepare('UPDATE botw SET ended = 1 WHERE ended = 0 AND ends_at <= ?').run(now);
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
        const top = sorted.slice(0, 5);
        await channel.send({
          embeds: [theme.embed('sotw', {
            title: `${sotw.skill} SOTW — results`,
            description: [
              theme.line('sotwEnded', sotw.id),
              sorted.length
                ? theme.rankLines(top, p => `**${p.player.displayName}** — ${p.progress.gained.toLocaleString()} XP`)
                : 'No XP was gained.',
            ].join('\n\n'),
            thumbnail: theme.skillIconUrl(sotw.skill),
            url: sotw.wom_competition_id
              ? `https://wiseoldman.net/competitions/${sotw.wom_competition_id}`
              : undefined,
          })],
        });
      }
    } catch (err) {
      console.error('Error fetching SOTW results:', err.message);
    }
  }

  if (winnerRsn) {
    db.prepare(`
      INSERT INTO sotw_winners (guild_id, sotw_id, skill, winner_rsn, xp_gained, starts_at, ends_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(sotw.guild_id, sotw.id, sotw.skill, winnerRsn, xpGained, sotw.starts_at, sotw.ends_at);
    const winner = db.prepare('SELECT user_id FROM members WHERE guild_id = ? AND lower(rsn) = lower(?)').get(sotw.guild_id, winnerRsn);
    if (winner) require('./economy').award(sotw.guild_id, winner.user_id, 'sotw_win');
  }

  db.prepare('UPDATE sotw SET ended = 1, winner_rsn = ? WHERE id = ?').run(winnerRsn, sotw.id);

  try {
    const sotwQueue = require('./sotwQueue');
    await sotwQueue.startNextQueuedSotw(sotw.guild_id, client);
  } catch (err) {
    console.error('Failed to start next queued SOTW:', err.message);
  }
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
      db.prepare('UPDATE polls SET finalized = 1, winner = ? WHERE id = ?').run('Channel missing', poll.id);
      return;
    }

    const message = await channel.messages.fetch(poll.message_id);
    if (!message || !message.poll) {
      db.prepare('UPDATE polls SET finalized = 1, winner = ? WHERE id = ?').run('Poll message missing', poll.id);
      return;
    }

    const answers = message.poll.answers;
    const sorted = [...answers.values()].sort((a, b) => b.voteCount - a.voteCount);

    if (sorted.length === 0 || sorted[0].voteCount === 0) {
      db.prepare('UPDATE polls SET finalized = 1, winner = ? WHERE id = ?').run('No votes', poll.id);
      await channel.send(`📊 **Poll ended:** ${poll.question}\n\nNo votes were cast.`);
      return;
    }

    const winner = sorted[0].text;
    db.prepare('UPDATE polls SET finalized = 1, winner = ? WHERE id = ?').run(winner, poll.id);

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

    if (poll.type === 'sotw' && poll.auto_start) {
      const skillMatch = winner.replace(/^[^\s]+\s/, '').toLowerCase().trim();
      const { startSotw } = require('./sotw');
      const sotwResult = await startSotw({
        guildId: poll.guild_id,
        channelId: poll.channel_id,
        createdBy: poll.created_by,
        skill: skillMatch,
        durationDays: poll.sotw_duration || 7,
        title: `SOTW: ${skillMatch.toUpperCase()} (Voted)`,
      });

      if (sotwResult.success) {
        await channel.send(sotwResult.embed
          ? { content: `${results}\n\n**${winner}** won. Week is live.`, embeds: [sotwResult.embed] }
          : { content: `${results}\n\n${sotwResult.response}` });
        return;
      }
      results += `\n\nFailed to auto-start SOTW: ${sotwResult.error}`;
    }

    await channel.send(results);
  } catch (err) {
    if (isMissingDiscordResource(err)) {
      db.prepare('UPDATE polls SET finalized = 1, winner = ? WHERE id = ?').run('Unavailable', poll.id);
    }
    console.error(`Failed to finalize poll ${poll.id}:`, err.message);
  }
}

module.exports = { startReminderPoller, finalizeSotw, finalizePoll };
