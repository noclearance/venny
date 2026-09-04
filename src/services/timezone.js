// Timezone service — parse user datetime input in guild timezone
const { DateTime } = require('luxon');
const { getDb } = require('../db/database');

const EVENT_CATEGORIES = ['general', 'boss', 'pvm', 'skilling', 'social', 'sotw', 'botw', 'raffle'];

const ABBREV_ZONES = {
  utc: 'UTC', gmt: 'UTC', z: 'UTC',
  est: 'UTC-5', edt: 'UTC-4',
  cst: 'UTC-6', cdt: 'UTC-5',
  mst: 'UTC-7', mdt: 'UTC-6',
  pst: 'UTC-8', pdt: 'UTC-7',
  akst: 'UTC-9', akdt: 'UTC-8',
  hst: 'UTC-10',
  bst: 'UTC+1',
  aest: 'UTC+10', aedt: 'UTC+11',
};

const FORMATS = [
  'yyyy-MM-dd HH:mm',
  'yyyy-MM-dd HH:mm:ss',
  'yyyy-M-d HH:mm',
  'yyyy-M-d H:mm',
  'yyyy-MM-dd h:mm a',
  'yyyy-M-d h:mm a',
  'MM/dd/yyyy HH:mm',
  'M/d/yyyy HH:mm',
  'M/d/yyyy H:mm',
  'MM/dd/yyyy h:mm a',
  'M/d/yyyy h:mm a',
  'MMM d yyyy HH:mm',
  'MMM d yyyy H:mm',
  'MMM d yyyy h:mm a',
  'MMM d h:mm a',
  'MMMM d yyyy HH:mm',
  'MMMM d yyyy h:mm a',
  'd MMM yyyy HH:mm',
  'd MMM yyyy h:mm a',
  'd MMMM yyyy HH:mm',
  'd MMMM yyyy h:mm a',
];

async function getGuildTimezone(guildId) {
  const db = getDb();
  const settings = await db.prepare('SELECT timezone FROM guild_settings WHERE guild_id = ?').get(guildId);
  return settings?.timezone || 'UTC';
}

function isValidTimezone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  const dt = DateTime.now().setZone(tz.trim());
  return dt.isValid;
}

function splitZone(raw) {
  let s = String(raw || '');
  let zone = null;
  const m = s.match(/\s+([A-Za-z]{2,5})$/);
  if (m && ABBREV_ZONES[m[1].toLowerCase()]) {
    zone = ABBREV_ZONES[m[1].toLowerCase()];
    s = s.slice(0, -m[0].length);
  }
  return { s, zone };
}

function normalize(raw) {
  let s = String(raw || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/,/g, ' ')
    .replace(/\s+at\s+/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["']|["']$/g, '');

  s = s.replace(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/ig, (_, h, min, ap) => {
    const mm = min || '00';
    const ampm = /^p/i.test(ap.replace(/\./g, '')) ? 'PM' : 'AM';
    return `${h}:${mm} ${ampm}`;
  });

  return s;
}

function parseInZone(datetimeStr, tz) {
  const { s: withAbbrev, zone: abbrevZone } = splitZone(datetimeStr);
  const zone = abbrevZone || tz || 'UTC';
  const s = normalize(withAbbrev);
  if (!s) return null;

  for (const fmt of FORMATS) {
    const dt = DateTime.fromFormat(s, fmt, { zone });
    if (!dt.isValid) continue;
    let out = dt;
    if (!/y/.test(fmt)) {
      const now = DateTime.now().setZone(zone);
      while (out.toMillis() <= now.toMillis()) out = out.plus({ years: 1 });
    }
    return out.toJSDate();
  }

  const iso = DateTime.fromISO(s, { zone });
  if (iso.isValid) return iso.toJSDate();

  const sql = DateTime.fromSQL(s, { zone });
  if (sql.isValid) return sql.toJSDate();

  return null;
}

async function parseEventDate(datetimeStr, guildId) {
  const tz = await getGuildTimezone(guildId);
  const raw = String(datetimeStr || '').trim();
  if (!raw) {
    return { date: null, tz, error: 'No date was entered.' };
  }
  const date = parseInZone(raw, tz);
  if (!date) {
    const shown = raw.length > 80 ? `${raw.slice(0, 77)}…` : raw;
    return {
      date: null,
      tz,
      error: `I could not read \`${shown}\` as a date. Server timezone is **${tz}**. Try \`2026-08-25 19:00\`, \`8/25/2026 7pm\`, or \`Dec 25 2026 7pm\`. You can append EST/PST. Change TZ with \`/config timezone\` (IANA name like \`America/Chicago\`, not CST).`,
    };
  }
  return { date, tz, error: null };
}

module.exports = { parseEventDate, parseInZone, getGuildTimezone, isValidTimezone, EVENT_CATEGORIES };
