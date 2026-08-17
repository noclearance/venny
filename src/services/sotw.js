// SOTW service — shared logic for starting SOTW competitions
// Used by both /sotw start command and poll auto-start
const { getDb } = require('../db/database');
const wom = require('./wom');

async function startSotw({ guildId, channelId, createdBy, skill, durationDays = 7, title = null }) {
  const db = getDb();
  const settings = await db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);

  const active = await db.prepare('SELECT * FROM sotw WHERE guild_id = ? AND ended = 0').get(guildId);
  if (active) {
    return { success: false, error: `There's already an active SOTW (#${active.id}: ${active.skill}). End it first.` };
  }

  const finalTitle = title || `SOTW: ${skill.toUpperCase()}`;
  const startsAt = new Date().toISOString();
  const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

  let womCompetitionId = null;
  let womError = null;

  if (settings && settings.wom_group_id && settings.wom_verif_code) {
    try {
      const comp = await wom.createCompetition({
        title: finalTitle,
        metric: skill,
        startsAt,
        endsAt,
        groupId: settings.wom_group_id,
        groupVerificationCode: settings.wom_verif_code,
      });
      womCompetitionId = comp.competition.id;
      console.log(`Created WOM competition ${womCompetitionId}: ${finalTitle}`);
    } catch (err) {
      womError = err.message;
      console.error('Failed to create WOM competition:', err.message);
    }
  }

  const result = await db.prepare(`
    INSERT INTO sotw (guild_id, skill, starts_at, ends_at, wom_competition_id, channel_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(guildId, skill, startsAt, endsAt, womCompetitionId, channelId, createdBy);

  const endTs = Math.floor(new Date(endsAt).getTime() / 1000);
  const theme = require('./theme');

  let tracking = 'Use `/sotw standings` once WOM is linked.';
  if (womCompetitionId) {
    tracking = `Tracked on [Wise Old Man](https://wiseoldman.net/competitions/${womCompetitionId})\nUse \`/sotw standings\` or \`/sotw me\`.`;
  } else if (womError) {
    tracking = `WOM was not created: ${womError}\nLocal SOTW is still running.`;
  } else {
    tracking = 'Not linked to WOM yet. Set group + verification with `/config`.';
  }

  const economy = require('./economy');
  const card = await require('./flavor').write({
    job: 'sotw_start',
    facts: { skill, days: durationDays },
    fallbackTitle: `${skill} SOTW`,
    fallbackDescription: [
      theme.line('sotwOpen', `${skill}-${result.lastInsertRowid}`),
      'Gains from this second. First on the board when it ends takes the week.',
    ].join('\n\n'),
  });
  const embed = theme.embed('sotw', {
    title: card.title,
    description: [
      card.description,
      tracking,
    ].join('\n\n'),
    thumbnail: theme.skillIconUrl(skill),
    url: womCompetitionId ? `https://wiseoldman.net/competitions/${womCompetitionId}` : undefined,
    fields: [
      theme.field('Ends', `<t:${endTs}:R>`, true),
      theme.field('ID', `#${result.lastInsertRowid}`, true),
      theme.field('Guild credits', economy.payNote('sotw_win')),
    ],
  });

  const response = [
    `🏆 **SOTW started** — **${skill.toUpperCase()}**`,
    `Ends <t:${endTs}:R> · ID #${result.lastInsertRowid}`,
    tracking,
  ].join('\n');

  try {
    await db.prepare(`
      INSERT INTO events (guild_id, title, description, event_time, channel_id, created_by, recurrence, category)
      VALUES (?, ?, ?, ?, ?, ?, 'none', 'sotw')
    `).run(
      guildId,
      `SOTW · ${skill}`,
      `${theme.line('sotwEvent', skill)}\nTracked until the deadline.${womCompetitionId ? ` https://wiseoldman.net/competitions/${womCompetitionId}` : ''}`,
      endsAt,
      channelId,
      createdBy
    );
  } catch (err) {
    console.error('SOTW calendar event failed:', err.message);
  }

  return { success: true, response, embed, sotwId: result.lastInsertRowid, womCompetitionId, card };
}

module.exports = { startSotw };
