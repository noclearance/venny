// Pagination service — central button-based pagination
// Custom ID format: page:<type>:<page>:<guildId>
// Types: members, events, raffles, sotw_standings

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getDb } = require('../db/database');

const ITEMS_PER_PAGE = 10;

function buildPaginationRow(type, currentPage, totalPages, guildId) {
  const row = new ActionRowBuilder();

  if (currentPage > 0) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`page:${type}:${currentPage - 1}:${guildId}`)
        .setLabel('◀ Previous')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`page_info:${type}`)
      .setLabel(`Page ${currentPage + 1}/${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true)
  );

  if (currentPage < totalPages - 1) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`page:${type}:${currentPage + 1}:${guildId}`)
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  return row;
}

async function getPaginatedData(type, guildId, page) {
  const db = getDb();
  const offset = page * ITEMS_PER_PAGE;

  if (type === 'members') {
    const total = db.prepare('SELECT COUNT(*) as count FROM members WHERE guild_id = ?').get(guildId).count;
    const items = db.prepare('SELECT * FROM members WHERE guild_id = ? ORDER BY rsn ASC LIMIT ? OFFSET ?').all(guildId, ITEMS_PER_PAGE, offset);
    return {
      totalPages: Math.max(1, Math.ceil(total / ITEMS_PER_PAGE)),
      total,
      items,
      formatter: (items) => items.map((m, i) => `${offset + i + 1}. **${m.rsn}** — <@${m.user_id}>`).join('\n'),
      title: 'Linked Members',
    };
  }

  if (type === 'events') {
    const now = new Date().toISOString();
    const total = db.prepare('SELECT COUNT(*) as count FROM events WHERE guild_id = ? AND event_time > ?').get(guildId, now).count;
    const items = db.prepare('SELECT * FROM events WHERE guild_id = ? AND event_time > ? ORDER BY event_time ASC LIMIT ? OFFSET ?').all(guildId, now, ITEMS_PER_PAGE, offset);
    const counts = attendanceCounts(db, items.map(e => e.id));
    return {
      totalPages: Math.max(1, Math.ceil(total / ITEMS_PER_PAGE)),
      total,
      items,
      formatter: (list) => list.map(e => {
        const ts = Math.floor(new Date(e.event_time).getTime() / 1000);
        const rsvp = counts.get(e.id) || { yes: 0, maybe: 0, no: 0 };
        const recur = e.recurrence && e.recurrence !== 'none' ? ` · repeats ${e.recurrence}` : '';
        return `**#${e.id}** — ${e.title}\n<t:${ts}:F> · <t:${ts}:R>\n${rsvp.yes} going · ${rsvp.maybe} maybe · ${rsvp.no} out${recur}`;
      }).join('\n\n'),
      title: 'Upcoming Events',
    };
  }

  if (type === 'raffles') {
    const total = db.prepare('SELECT COUNT(*) as count FROM raffles WHERE guild_id = ?').get(guildId).count;
    const items = db.prepare('SELECT * FROM raffles WHERE guild_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(guildId, ITEMS_PER_PAGE, offset);
    return {
      totalPages: Math.max(1, Math.ceil(total / ITEMS_PER_PAGE)),
      total,
      items,
      formatter: (items) => items.map(r => {
        const status = r.drawn ? `✅ Winner: <@${r.winner_id}>` : '🟢 Active';
        const weight = r.weight_mode && r.weight_mode !== 'none' ? ` | 📊 ${r.weight_mode}` : '';
        return `**#${r.id}** — ${r.title} (${status}${weight})`;
      }).join('\n'),
      title: 'Raffles',
    };
  }

  return null;
}

function attendanceCounts(db, eventIds) {
  const map = new Map();
  if (!eventIds.length) return map;
  const placeholders = eventIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT event_id, status, COUNT(*) as count
    FROM event_attendance
    WHERE event_id IN (${placeholders})
    GROUP BY event_id, status
  `).all(...eventIds);
  for (const id of eventIds) map.set(id, { yes: 0, maybe: 0, no: 0 });
  for (const row of rows) {
    const bucket = map.get(row.event_id);
    if (bucket && bucket[row.status] != null) bucket[row.status] = row.count;
  }
  return map;
}

function buildPagePayload(type, data, page, guildId) {
  const theme = require('./theme');
  const kind = type === 'events' ? 'event' : type === 'raffles' ? 'raffle' : 'info';
  const embed = theme.embed(kind, {
    title: `${data.title} · ${data.total}`,
    description: data.formatter(data.items),
  });
  const components = data.totalPages > 1 ? [buildPaginationRow(type, page, data.totalPages, guildId)] : [];
  return { embeds: [embed], components, content: null };
}

module.exports = { buildPaginationRow, getPaginatedData, buildPagePayload, ITEMS_PER_PAGE };
