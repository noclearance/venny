// SOTW service — shared logic for starting SOTW competitions
// Used by both /sotw start command and poll auto-start
const { getDb } = require('../db/database');
const wom = require('./wom');

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

function pickLiveCompetition(rows, skill = null, now = Date.now()) {
  const list = Array.isArray(rows) ? rows : [];
  const want = String(skill || '').toLowerCase();
  const live = list.filter(c => {
    const ends = competitionEnd(c);
    const starts = competitionStart(c);
    return Number.isFinite(ends) && ends > now && (!Number.isFinite(starts) || starts <= now + 60_000);
  });
  if (!live.length) return null;
  if (want) return live.find(c => competitionMetric(c) === want) || null;
  return live[0];
}

async function findLiveCompetition(groupId, skill = null) {
  const raw = await wom.getGroupCompetitions(groupId, 25);
  const rows = Array.isArray(raw) ? raw : (raw?.competitions || []);
  return pickLiveCompetition(rows, skill);
}

async function attachCompetition(sotw, comp) {
  const db = getDb();
  const id = competitionId(comp);
  if (!id) return { sotw, linked: false, created: false, error: 'WOM did not return a competition id.' };
  const metric = competitionMetric(comp) || sotw.skill;
  const endsAt = comp.endsAt || comp.ends_at || sotw.ends_at;
  await db.prepare('UPDATE sotw SET wom_competition_id = ?, skill = ?, ends_at = ? WHERE id = ?')
    .run(id, metric || sotw.skill, endsAt, sotw.id);
  console.log(`Linked WOM competition ${id} to SOTW #${sotw.id}`);
  return {
    sotw: { ...sotw, wom_competition_id: id, skill: metric || sotw.skill, ends_at: endsAt },
    linked: true,
    created: false,
    adopted: true,
  };
}

async function createCompetition(sotw, settings, title) {
  const db = getDb();
  const comp = await wom.createCompetition({
    title: String(title || `SOTW ${String(sotw.skill || '').toUpperCase()}`).slice(0, 50),
    metric: sotw.skill,
    startsAt: sotw.starts_at,
    endsAt: sotw.ends_at,
    groupId: settings.wom_group_id,
    groupVerificationCode: settings.wom_verif_code,
  });
  const id = competitionId(comp);
  if (!id) return { sotw, linked: false, created: false, error: 'WOM did not return a competition id.' };
  await db.prepare('UPDATE sotw SET wom_competition_id = ? WHERE id = ?').run(id, sotw.id);
  console.log(`Created WOM competition ${id} for SOTW #${sotw.id}`);
  return { sotw: { ...sotw, wom_competition_id: id }, linked: true, created: true };
}

async function ensureWomWeek(sotw, { title } = {}) {
  if (!sotw || sotw.wom_competition_id) return { sotw, linked: false, created: false };
  const db = getDb();
  const settings = await db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(sotw.guild_id);
  if (!settings?.wom_group_id) {
    return { sotw, linked: false, created: false, error: 'Set `/config wom-group` first.' };
  }

  try {
    const live = await findLiveCompetition(settings.wom_group_id, sotw.skill);
    if (live) return attachCompetition(sotw, live);
  } catch (err) {
    console.warn(`WOM list competitions: ${err.message}`);
  }

  if (!settings.wom_verif_code) {
    return {
      sotw,
      linked: false,
      created: false,
      error: 'No live WOM competition for that skill, and verification is not set to create one.',
    };
  }

  try {
    return await createCompetition(sotw, settings, title);
  } catch (err) {
    console.error('Failed to link WOM competition:', err.message);
    return { sotw, linked: false, created: false, error: err.message };
  }
}

function trackingLine(sotw, linked) {
  const id = sotw?.wom_competition_id;
  if (id) {
    const how = linked.adopted ? 'Attached the live' : 'Tracked on';
    return `${how} [Wise Old Man](https://wiseoldman.net/competitions/${id}) week.\nUse \`/sotw standings\` or \`/sotw me\`.`;
  }
  if (linked.error) return `WOM was not created: ${linked.error}\nLocal SOTW is still running.`;
  return 'Not linked to WOM yet. Set group + verification with `/config`.';
}

async function startSotw({ guildId, channelId, createdBy, skill, durationDays = 7, title = null }) {
  const db = getDb();
  const active = await db.prepare('SELECT * FROM sotw WHERE guild_id = ? AND ended = 0').get(guildId);
  if (active) {
    return { success: false, error: `There's already an active SOTW (#${active.id}: ${active.skill}). End it first.` };
  }

  const finalTitle = String(title || `SOTW ${String(skill || '').toUpperCase()}`).trim().slice(0, 50);
  const startsAt = new Date().toISOString();
  const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

  const result = await db.prepare(`
    INSERT INTO sotw (guild_id, skill, starts_at, ends_at, wom_competition_id, channel_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(guildId, skill, startsAt, endsAt, null, channelId, createdBy);

  const inserted = {
    id: result.lastInsertRowid,
    guild_id: guildId,
    skill,
    starts_at: startsAt,
    ends_at: endsAt,
    wom_competition_id: null,
    channel_id: channelId,
    created_by: createdBy,
  };
  const linked = await ensureWomWeek(inserted, { title: finalTitle });
  const sotw = linked.sotw;
  const tracking = trackingLine(sotw, linked);

  const endTs = Math.floor(new Date(sotw.ends_at).getTime() / 1000);
  const theme = require('./theme');
  const economy = require('./economy');
  const windowDays = Math.max(1, Math.round((new Date(sotw.ends_at) - new Date(sotw.starts_at)) / 86400000)) || durationDays;
  const made = await require('./cards').make('sotw', {
    job: 'sotw_start',
    facts: { skill: sotw.skill, days: windowDays, wom: Boolean(sotw.wom_competition_id) },
    extraLines: [tracking],
    thumbnail: theme.skillIconUrl(sotw.skill),
    url: sotw.wom_competition_id ? `https://wiseoldman.net/competitions/${sotw.wom_competition_id}` : undefined,
    fields: [
      theme.field('Ends', `<t:${endTs}:R>`, true),
      theme.field('ID', `#${sotw.id}`, true),
      theme.field('Guild credits', economy.payNote('sotw_win')),
    ],
  });

  const response = [
    `🏆 **SOTW started** — **${String(sotw.skill).toUpperCase()}**`,
    `Ends <t:${endTs}:R> · ID #${sotw.id}`,
    tracking,
  ].join('\n');

  return {
    success: true,
    response,
    embed: made.embed,
    sotwId: sotw.id,
    womCompetitionId: sotw.wom_competition_id,
    card: made.json,
    tracking,
  };
}

async function adoptLiveFromWom({ guildId, channelId, createdBy }) {
  const db = getDb();
  const active = await db.prepare('SELECT * FROM sotw WHERE guild_id = ? AND ended = 0').get(guildId);
  if (active) {
    return { success: false, error: `There's already an active SOTW (#${active.id}: ${active.skill}).` };
  }
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

module.exports = {
  startSotw,
  ensureWomWeek,
  adoptLiveFromWom,
  statusOf,
  findLiveCompetition,
  pickLiveCompetition,
};
