// Timezone service — parse user datetime input in guild timezone
const { DateTime } = require('luxon');
const { getDb } = require('../db/database');

const EVENT_CATEGORIES = ['general', 'boss', 'pvm', 'skilling', 'social', 'sotw', 'botw', 'raffle'];

function getGuildTimezone(guildId) {
  const db = getDb();
  const settings = db.prepare('SELECT timezone FROM guild_settings WHERE guild_id = ?').get(guildId);
  return settings?.timezone || 'UTC';
}

function isValidTimezone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  const dt = DateTime.now().setZone(tz.trim());
  return dt.isValid;
}

// Parse a user-provided datetime string in the guild's timezone
// Returns a JS Date in UTC, or null if parsing fails
function parseEventDate(datetimeStr, guildId) {
  const tz = getGuildTimezone(guildId);

  const formats = [
    'yyyy-MM-dd HH:mm',
    'yyyy-MM-dd h:mm a',
    'yyyy-MM-dd h:mma',
    'MM/dd/yyyy HH:mm',
    'MM/dd/yyyy h:mm a',
    'MMM d yyyy HH:mm',
    'MMM d yyyy h:mm a',
    'MMM d h:mm a',
    'MMMM d yyyy h:mm a',
    'd MMM yyyy HH:mm',
    'd MMM yyyy h:mm a',
  ];

  for (const fmt of formats) {
    const dt = DateTime.fromFormat(datetimeStr, fmt, { zone: tz });
    if (dt.isValid) {
      return dt.toJSDate();
    }
  }

  const iso = DateTime.fromISO(datetimeStr, { zone: tz });
  if (iso.isValid) {
    return iso.toJSDate();
  }

  return null;
}

module.exports = { parseEventDate, getGuildTimezone, isValidTimezone, EVENT_CATEGORIES };
