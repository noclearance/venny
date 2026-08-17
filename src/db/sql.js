function toPgPlaceholders(sql) {
  let n = 0;
  return String(sql).replace(/\?/g, () => `$${++n}`);
}

function translateSql(sql) {
  let s = String(sql);
  const orIgnore = /INSERT OR IGNORE INTO/i.test(s);
  const orReplace = /INSERT OR REPLACE INTO/i.test(s);
  s = s.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
  s = s.replace(/INSERT OR IGNORE INTO/gi, 'INSERT INTO');
  s = s.replace(/INSERT OR REPLACE INTO/gi, 'INSERT INTO');
  s = s.replace(/ON CONFLICT\(([^)]+)\)/gi, 'ON CONFLICT ($1)');
  s = s.replace(/\bexcluded\./gi, 'EXCLUDED.');
  if (orIgnore && !/ON CONFLICT/i.test(s)) {
    s = s.replace(/\s*;?\s*$/, ' ON CONFLICT DO NOTHING');
  }
  if (orReplace && !/ON CONFLICT/i.test(s) && /event_roles/i.test(s)) {
    s = s.replace(/\s*;?\s*$/, ' ON CONFLICT (guild_id, category) DO UPDATE SET role_id = EXCLUDED.role_id');
  }
  return toPgPlaceholders(s);
}

function coerceRow(row) {
  if (!row) return undefined;
  const out = { ...row };
  for (const key of ['id', 'count', 'coins', 'amount', 'changes', 'points', 'ticket_gp', 'sotw_duration', 'auto_start', 'finalized', 'drawn', 'ended', 'reminder_sent', 'next_created', 'cancelled', 'reached', 'announced', 'size', 'slot', 'bingo_id', 'tile_id', 'team_id', 'event_id', 'raffle_id', 'sotw_id', 'wom_id', 'wom_group_id', 'wom_competition_id', 'parent_event_id', 'source_poll_id', 'xp_gained', 'weight', 'target', 'duration_days']) {
    if (out[key] != null && typeof out[key] === 'string' && /^-?\d+$/.test(out[key])) {
      out[key] = Number(out[key]);
    }
  }
  return out;
}

module.exports = { translateSql, coerceRow };
