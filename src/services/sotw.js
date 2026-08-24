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

  const finalTitle = String(title || `SOTW ${String(skill || '').toUpperCase()}`).trim().slice(0, 50);
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
      womCompetitionId = comp.competition?.id || comp.id || null;
      if (!womCompetitionId) {
        womError = 'WOM did not return a competition id.';
      } else {
        console.log(`Created WOM competition ${womCompetitionId}: ${finalTitle}`);
      }
    } catch (err) {
      womError = err.message;
      womCompetitionId = null;
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
  const made = await require('./cards').make('sotw', {
    job: 'sotw_start',
    facts: { skill, days: durationDays, wom: Boolean(womCompetitionId) },
    extraLines: [tracking],
    thumbnail: theme.skillIconUrl(skill),
    url: womCompetitionId ? `https://wiseoldman.net/competitions/${womCompetitionId}` : undefined,
    fields: [
      theme.field('Ends', `<t:${endTs}:R>`, true),
      theme.field('ID', `#${result.lastInsertRowid}`, true),
      theme.field('Guild credits', economy.payNote('sotw_win')),
    ],
  });
  const embed = made.embed;
  const card = made.json;

  const response = [
    `🏆 **SOTW started** — **${skill.toUpperCase()}**`,
    `Ends <t:${endTs}:R> · ID #${result.lastInsertRowid}`,
    tracking,
  ].join('\n');

  return { success: true, response, embed, sotwId: result.lastInsertRowid, womCompetitionId, card, tracking };
}

function competitionId(comp) {
  return comp?.competition?.id || comp?.id || null;
}

function competitionMetric(comp) {
  return String(comp?.metric || comp?.metricName || '').toLowerCase();
}

function competitionEnd(comp) {
  return new Date(comp?.endsAt || comp?.ends_at || 0).getTime();
}

function competitionStart(comp) {
  return new Date(comp?.startsAt || comp?.starts_at || 0).getTime();
}

async function findLiveCompetition(groupId, skill = null) {
  const raw = await wom.getGroupCompetitions(groupId, 25);
  const rows = Array.isArray(raw) ? raw : (raw?.competitions || []);
  const now = Date.now();
  const want = String(skill || '').toLowerCase();
  const live = rows.filter(c => {
    const ends = competitionEnd(c);
    const starts = competitionStart(c);
    return Number.isFinite(ends) && ends > now && (!Number.isFinite(starts) || starts <= now + 60_000);
  });
  if (!live.length) return null;
  if (want) {
    const match = live.find(c => competitionMetric(c) === want);
    if (match) return match;
  }
  return live[0];
}

async function attachCompetition(sotw, comp) {
  const db = getDb();
  const id = competitionId(comp);
  if (!id) return { sotw, created: false, error: 'WOM did not return a competition id.' };
  const metric = competitionMetric(comp) || sotw.skill;
  const endsAt = comp.endsAt || comp.ends_at || sotw.ends_at;
  await db.prepare('UPDATE sotw SET wom_competition_id = ?, skill = ?, ends_at = ? WHERE id = ?')
    .run(id, metric || sotw.skill, endsAt, sotw.id);
  console.log(`Linked WOM competition ${id} to SOTW #${sotw.id}`);
  return {
    sotw: { ...sotw, wom_competition_id: id, skill: metric || sotw.skill, ends_at: endsAt },
    created: true,
    adopted: true,
  };
}

async function linkWomIfMissing(sotw) {
  if (!sotw || sotw.wom_competition_id) return { sotw, created: false };
  const db = getDb();
  const settings = await db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(sotw.guild_id);
  if (!settings?.wom_group_id) {
    return { sotw, created: false, error: 'Set `/config wom-group` first.' };
  }

  try {
    const live = await findLiveCompetition(settings.wom_group_id, sotw.skill);
    if (live) return attachCompetition(sotw, live);
  } catch (err) {
    console.warn(`WOM list competitions: ${err.message}`);
  }

  if (!settings.wom_verif_code) {
    return { sotw, created: false, error: 'No live WOM competition on the group, and verification is not set to create one.' };
  }
  const title = `SOTW ${String(sotw.skill || '').toUpperCase()}`.slice(0, 50);
  try {
    const comp = await wom.createCompetition({
      title,
      metric: sotw.skill,
      startsAt: sotw.starts_at,
      endsAt: sotw.ends_at,
      groupId: settings.wom_group_id,
      groupVerificationCode: settings.wom_verif_code,
    });
    const id = competitionId(comp);
    if (!id) return { sotw, created: false, error: 'WOM did not return a competition id.' };
    await db.prepare('UPDATE sotw SET wom_competition_id = ? WHERE id = ?').run(id, sotw.id);
    console.log(`Created WOM competition ${id} for SOTW #${sotw.id}`);
    return { sotw: { ...sotw, wom_competition_id: id }, created: true };
  } catch (err) {
    console.error('Failed to link WOM competition:', err.message);
    return { sotw, created: false, error: err.message };
  }
}

async function adoptLiveFromWom({ guildId, channelId, createdBy }) {
  const db = getDb();
  const settings = await db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
  if (!settings?.wom_group_id) {
    return { success: false, error: 'Set `/config wom-group` first.' };
  }
  const live = await findLiveCompetition(settings.wom_group_id);
  if (!live) {
    return { success: false, error: 'No competition is running on the WOM group right now.' };
  }
  const skill = competitionMetric(live) || 'overall';
  const startsAt = live.startsAt || live.starts_at || new Date().toISOString();
  const endsAt = live.endsAt || live.ends_at || new Date(Date.now() + 7 * 86400000).toISOString();
  const id = competitionId(live);
  const result = await db.prepare(`
    INSERT INTO sotw (guild_id, skill, starts_at, ends_at, wom_competition_id, channel_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(guildId, skill, startsAt, endsAt, id, channelId, createdBy);
  return {
    success: true,
    sotw: {
      id: result.lastInsertRowid,
      guild_id: guildId,
      skill,
      starts_at: startsAt,
      ends_at: endsAt,
      wom_competition_id: id,
    },
  };
}

function statusOf(sotw) {
  if (!sotw || Number(sotw.ended)) return 'ended';
  if (sotw.wom_competition_id) return 'wom';
  return 'local';
}

module.exports = { startSotw, linkWomIfMissing, adoptLiveFromWom, statusOf, findLiveCompetition };
