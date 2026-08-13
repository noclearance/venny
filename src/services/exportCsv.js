const { AttachmentBuilder } = require('discord.js');
const { getDb } = require('../db/database');

function csv(rows, columns) {
  const header = columns.join(',');
  const body = rows.map(row => columns.map(col => {
    const value = row[col] == null ? '' : String(row[col]).replace(/"/g, '""');
    return `"${value}"`;
  }).join(','));
  return [header, ...body].join('\n');
}

function build(guildId, type) {
  const db = getDb();
  if (type === 'attendance') {
    const rows = db.prepare(`
      SELECT e.id as event_id, e.title, e.event_time, ea.user_id, ea.status
      FROM event_attendance ea JOIN events e ON e.id = ea.event_id
      WHERE e.guild_id = ?
      ORDER BY e.id DESC
    `).all(guildId);
    return { name: 'attendance.csv', text: csv(rows, ['event_id', 'title', 'event_time', 'user_id', 'status']) };
  }
  if (type === 'sotw') {
    const rows = db.prepare('SELECT * FROM sotw_winners WHERE guild_id = ? ORDER BY id DESC').all(guildId);
    return { name: 'sotw.csv', text: csv(rows, ['id', 'skill', 'winner_rsn', 'xp_gained', 'starts_at', 'ends_at']) };
  }
  if (type === 'raffle') {
    const rows = db.prepare('SELECT id, title, drawn, winner_id, created_at FROM raffles WHERE guild_id = ?').all(guildId);
    return { name: 'raffles.csv', text: csv(rows, ['id', 'title', 'drawn', 'winner_id', 'created_at']) };
  }
  if (type === 'bingo') {
    const rows = db.prepare(`
      SELECT p.bingo_id, t.label, p.user_id, p.status, p.completed_at
      FROM bingo_progress p JOIN bingo_tiles t ON t.id = p.tile_id
      JOIN bingo_events b ON b.id = p.bingo_id
      WHERE b.guild_id = ?
    `).all(guildId);
    return { name: 'bingo.csv', text: csv(rows, ['bingo_id', 'label', 'user_id', 'status', 'completed_at']) };
  }
  throw new Error('Unknown export type');
}

function asAttachment(guildId, type) {
  const file = build(guildId, type);
  return new AttachmentBuilder(Buffer.from(file.text, 'utf8'), { name: file.name });
}

module.exports = { build, asAttachment };
