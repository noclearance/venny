const { getDb } = require('../db/database');
const theme = require('./theme');
const { pickTiles, prettyMetric } = require('../osrs/catalog');
const { loadPlayer, compactSnapshot } = require('../osrs/snapshot');
const { award } = require('./economy');

async function activeBingo(guildId) {
  const db = getDb();
  return await db.prepare(`
    SELECT * FROM bingo_events
    WHERE guild_id = ? AND status IN ('draft','active','paused')
    ORDER BY id DESC
  `).get(guildId);
}

async function getBingo(guildId, id) {
  const db = getDb();
  if (id) return await db.prepare('SELECT * FROM bingo_events WHERE id = ? AND guild_id = ?').get(id, guildId);
  return await activeBingo(guildId);
}

async function tilesOf(bingoId) {
  return await getDb().prepare('SELECT * FROM bingo_tiles WHERE bingo_id = ? ORDER BY slot ASC').all(bingoId);
}

function capacityOf(bingo) {
  if (bingo.layout === 'list') return 25;
  const side = Number(bingo.size) === 4 ? 4 : 5;
  return side * side;
}

async function createBingo({ guildId, title, themeName, size, layout, createdBy, channelId, empty }) {
  const layoutName = layout || (size === 'list' ? 'list' : 'grid');
  const side = size === 4 || size === '4' ? 4 : 5;
  const count = layoutName === 'list' ? 25 : side * side;
  const db = getDb();
  const result = await db.prepare(`
    INSERT INTO bingo_events (guild_id, title, theme, size, status, channel_id, created_by, layout)
    VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)
  `).run(guildId, title, themeName || 'custom', side, channelId, createdBy, layoutName);
  const bingoId = result.lastInsertRowid;
  if (!empty && themeName && themeName !== 'blank') {
    const picked = pickTiles(themeName, count);
    await replaceTiles(bingoId, picked);
  }
  return await getBingo(guildId, bingoId);
}

async function replaceTiles(bingoId, tiles) {
  const db = getDb();
  await db.prepare('DELETE FROM bingo_progress WHERE bingo_id = ?').run(bingoId);
  await db.prepare('DELETE FROM bingo_tiles WHERE bingo_id = ?').run(bingoId);
  const insert = db.prepare(`
    INSERT INTO bingo_tiles (bingo_id, slot, label, verify_mode, metric, amount, notes, points)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    await insert.run(
      bingoId,
      tile.slot ?? i,
      tile.label,
      tile.verify_mode || 'screenshot',
      tile.metric || null,
      tile.amount || 0,
      tile.notes || null,
      tile.points || 1
    );
  }
}

async function applyTemplate(bingo, key) {
  const { getTemplate } = require('./bingoTemplates');
  const tpl = getTemplate(key);
  if (!tpl) return { ok: false, error: 'Unknown template.' };
  const max = capacityOf(bingo);
  await replaceTiles(bingo.id, tpl.tiles.slice(0, max).map((t, i) => ({ ...t, slot: i })));
  await getDb().prepare('UPDATE bingo_events SET theme = ? WHERE id = ?').run(key, bingo.id);
  return { ok: true, loaded: Math.min(tpl.tiles.length, max) };
}

async function lastGuildBoard(guildId, exceptId) {
  return await getDb().prepare(`
    SELECT * FROM bingo_events
    WHERE guild_id = ? AND id != ? AND status IN ('ended','active','paused','draft')
    ORDER BY id DESC
  `).get(guildId, exceptId || 0);
}

async function copyTilesFrom(sourceId, destId, max) {
  const tiles = (await tilesOf(sourceId)).slice(0, max);
  await replaceTiles(destId, tiles.map((t, i) => ({
    slot: i,
    label: t.label,
    verify_mode: t.verify_mode,
    metric: t.metric,
    amount: t.amount,
    notes: t.notes,
    points: t.points,
  })));
  return tiles.length;
}

async function swapTiles(bingoId, slotA, slotB) {
  const db = getDb();
  const a = await db.prepare('SELECT * FROM bingo_tiles WHERE bingo_id = ? AND slot = ?').get(bingoId, slotA);
  const b = await db.prepare('SELECT * FROM bingo_tiles WHERE bingo_id = ? AND slot = ?').get(bingoId, slotB);
  if (!a || !b) return false;
  await db.prepare('UPDATE bingo_tiles SET slot = -1 WHERE id = ?').run(a.id);
  await db.prepare('UPDATE bingo_tiles SET slot = ? WHERE id = ?').run(slotA, b.id);
  await db.prepare('UPDATE bingo_tiles SET slot = ? WHERE id = ?').run(slotB, a.id);
  return true;
}

function isEditable(bingo) {
  return bingo && (bingo.status === 'draft' || bingo.status === 'paused');
}

async function setTile(bingoId, slot, { label, verifyMode, metric, amount }) {
  const db = getDb();
  const existing = await db.prepare('SELECT * FROM bingo_tiles WHERE bingo_id = ? AND slot = ?').get(bingoId, slot);
  if (existing) {
    await db.prepare('UPDATE bingo_tiles SET label = ?, verify_mode = ?, metric = ?, amount = ? WHERE id = ?')
      .run(label, verifyMode, metric || null, amount || 0, existing.id);
    return existing.id;
  }
  const result = await db.prepare('INSERT INTO bingo_tiles (bingo_id, slot, label, verify_mode, metric, amount) VALUES (?, ?, ?, ?, ?, ?)')
    .run(bingoId, slot, label, verifyMode, metric || null, amount || 0);
  return result.lastInsertRowid;
}

async function createTeam(bingoId, name, createdBy) {
  const db = getDb();
  const result = await db.prepare('INSERT INTO bingo_teams (bingo_id, name, created_by) VALUES (?, ?, ?)').run(bingoId, name, createdBy);
  return result.lastInsertRowid;
}

async function joinTeam(teamId, userId) {
  const db = getDb();
  const team = await db.prepare('SELECT * FROM bingo_teams WHERE id = ?').get(teamId);
  if (!team) return null;
  await db.prepare('DELETE FROM bingo_team_members WHERE user_id = ? AND team_id IN (SELECT id FROM bingo_teams WHERE bingo_id = ?)').run(userId, team.bingo_id);
  await db.prepare('INSERT OR IGNORE INTO bingo_team_members (team_id, user_id) VALUES (?, ?)').run(teamId, userId);
  return team;
}

async function teamOf(bingoId, userId) {
  return await getDb().prepare(`
    SELECT t.* FROM bingo_teams t
    JOIN bingo_team_members m ON m.team_id = t.id
    WHERE t.bingo_id = ? AND m.user_id = ?
  `).get(bingoId, userId);
}

async function listTeams(bingoId) {
  const db = getDb();
  const teams = await db.prepare('SELECT * FROM bingo_teams WHERE bingo_id = ? ORDER BY id ASC').all(bingoId);
  const out = [];
  for (const team of teams) {
    const members = await db.prepare('SELECT user_id FROM bingo_team_members WHERE team_id = ?').all(team.id);
    const done = (await db.prepare(`
      SELECT COUNT(DISTINCT tile_id) as count FROM bingo_progress
      WHERE bingo_id = ? AND team_id = ? AND status = 'complete'
    `).get(bingoId, team.id)).count;
    out.push({ ...team, members, completed: done });
  }
  return out;
}

async function completedSlots(bingoId) {
  const rows = await getDb().prepare(`
    SELECT DISTINCT t.slot FROM bingo_progress p
    JOIN bingo_tiles t ON t.id = p.tile_id
    WHERE p.bingo_id = ? AND p.status = 'complete'
  `).all(bingoId);
  return new Set(rows.map(r => r.slot));
}

function isWomMode(mode) {
  return ['wom_xp', 'wom_kc', 'wom_activity', 'wom_level'].includes(mode);
}

async function progressOf(bingoId, userId) {
  return await getDb().prepare(`
    SELECT p.status, p.proof, p.tile_id, t.slot, t.label
    FROM bingo_progress p
    JOIN bingo_tiles t ON t.id = p.tile_id
    WHERE p.bingo_id = ? AND p.user_id = ?
  `).all(bingoId, userId);
}

async function saveMessage(bingoId, channelId, messageId) {
  await getDb().prepare('UPDATE bingo_events SET channel_id = ?, message_id = ? WHERE id = ?')
    .run(channelId, messageId, bingoId);
}

async function claimTile({ card, tile, userId, proof, status = 'pending', verifiedBy = null, client }) {
  const team = await teamOf(card.id, userId);
  await markComplete({ bingo: card, tile, userId, teamId: team?.id, proof, verifiedBy, status, client });
}

async function ensureBaseline(card, userId) {
  const db = getDb();
  const existing = await db.prepare('SELECT snapshot_json FROM bingo_baselines WHERE bingo_id = ? AND user_id = ?')
    .get(card.id, userId);
  if (existing) return { ok: true, created: false };
  const member = await db.prepare('SELECT * FROM members WHERE guild_id = ? AND user_id = ?').get(card.guild_id, userId);
  if (!member?.rsn) return { ok: false, reason: 'need_rsn' };
  try {
    const parsed = await loadPlayer(member.rsn, { refresh: true });
    await db.prepare(`
      INSERT INTO bingo_baselines (bingo_id, user_id, snapshot_json, taken_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(card.id, userId, JSON.stringify(compactSnapshot(parsed)));
    return { ok: true, created: true, rsn: member.rsn };
  } catch (err) {
    return { ok: false, reason: 'wom_fail', error: err.message };
  }
}

async function checkWomTile(card, tile, userId) {
  const db = getDb();
  const member = await db.prepare('SELECT * FROM members WHERE guild_id = ? AND user_id = ?').get(card.guild_id, userId);
  if (!member?.rsn) return { ok: false, reason: 'need_rsn' };

  const baseline = await ensureBaseline(card, userId);
  if (!baseline.ok) return baseline;
  if (baseline.created) return { ok: false, reason: 'baseline_set', rsn: member.rsn };

  const baseRow = await db.prepare('SELECT snapshot_json FROM bingo_baselines WHERE bingo_id = ? AND user_id = ?')
    .get(card.id, userId);
  const current = compactSnapshot(await loadPlayer(member.rsn, { refresh: true }));
  const snap = JSON.parse(baseRow.snapshot_json);
  const gained = tile.verify_mode === 'wom_level'
    ? metricValue(current, tile)
    : metricValue(current, tile) - metricValue(snap, tile);
  const need = tile.verify_mode === 'wom_level' ? (tile.amount || 99) : (tile.amount || 1);
  if (gained >= need) return { ok: true, gained, need, rsn: member.rsn };
  return { ok: false, reason: 'short', gained, need, rsn: member.rsn };
}

async function boardText(bingo) {
  const tiles = await tilesOf(bingo.id);
  const done = await completedSlots(bingo.id);
  const lines = tiles.map(tile =>
    `${done.has(tile.slot) ? '✅' : '⬜'} **${tile.slot + 1}.** ${tile.label}`
  );
  if (bingo.layout === 'list') {
    return { grid: '', list: lines.join('\n') };
  }
  const side = Number(bingo.size) === 4 ? 4 : 5;
  return { grid: chunkVisual(side, done), list: lines.join('\n') };
}

function chunkVisual(side, done) {
  const rows = [];
  for (let r = 0; r < side; r++) {
    let line = '';
    for (let c = 0; c < side; c++) {
      line += done.has(r * side + c) ? '🟩' : '⬛';
    }
    rows.push(line);
  }
  return rows.join('\n');
}

async function boardEmbed(bingo) {
  const { grid, list } = await boardText(bingo);
  const visual = bingo.layout === 'list' || !grid ? list : `${grid}\n\n${list}`;
  const sizeLabel = bingo.layout === 'list' ? 'list' : `${bingo.size}×${bingo.size}`;
  const teams = (await listTeams(bingo.id))
    .sort((a, b) => b.completed - a.completed)
    .slice(0, 8)
    .map((t, i) => `${i + 1}. **${t.name}** · ${t.completed} tiles · ${t.members.length} ppl`)
    .join('\n') || 'No teams yet. `/bingo team`.';

  return theme.embed('raffle', {
    title: `${bingo.title} · ${bingo.status}`,
    description: visual.slice(0, 1800) || '_No tiles yet._',
    fields: [
      theme.field('Theme', bingo.theme, true),
      theme.field('Size', sizeLabel, true),
      theme.field('#', String(bingo.id), true),
      theme.field('Teams', teams),
    ],
    footer: '🟩 done · ⬛ still open · Claim a tile or /bingo submit',
  });
}

async function snapshotBaselines(bingo, guildId) {
  const db = getDb();
  const members = await db.prepare('SELECT * FROM members WHERE guild_id = ?').all(guildId);
  for (const member of members) {
    try {
      const parsed = await loadPlayer(member.rsn, { refresh: true });
      await db.prepare(`
        INSERT INTO bingo_baselines (bingo_id, user_id, snapshot_json, taken_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(bingo_id, user_id) DO UPDATE SET snapshot_json = excluded.snapshot_json, taken_at = excluded.taken_at
      `).run(bingo.id, member.user_id, JSON.stringify(compactSnapshot(parsed)));
    } catch (err) {
      console.error(`Bingo baseline failed for ${member.rsn}:`, err.message);
    }
  }
}

async function markComplete({ bingo, tile, userId, teamId, proof, verifiedBy, status = 'complete', client }) {
  const db = getDb();
  const prior = await db.prepare('SELECT status FROM bingo_progress WHERE bingo_id = ? AND tile_id = ? AND user_id = ?')
    .get(bingo.id, tile.id, userId);
  await db.prepare(`
    INSERT INTO bingo_progress (bingo_id, tile_id, user_id, team_id, status, proof, verified_by, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(bingo_id, tile_id, user_id) DO UPDATE SET
      status = excluded.status,
      proof = excluded.proof,
      verified_by = excluded.verified_by,
      completed_at = excluded.completed_at,
      team_id = excluded.team_id
  `).run(bingo.id, tile.id, userId, teamId || null, status, proof || null, verifiedBy || null);
  if (status === 'complete' && prior?.status !== 'complete') await award(bingo.guild_id, userId, 'bingo_tile', client);
}

function metricValue(snap, tile) {
  if (!snap) return 0;
  if (tile.verify_mode === 'wom_xp') return snap.skills?.[tile.metric] || 0;
  if (tile.verify_mode === 'wom_kc') return snap.bosses?.[tile.metric] || 0;
  if (tile.verify_mode === 'wom_activity') return snap.activities?.[tile.metric] || 0;
  if (tile.verify_mode === 'wom_level') return snap.levels?.[tile.metric] || 0;
  return 0;
}

async function autoCheckMember(bingo, member, client) {
  const db = getDb();
  const baseRow = await db.prepare('SELECT snapshot_json FROM bingo_baselines WHERE bingo_id = ? AND user_id = ?').get(bingo.id, member.user_id);
  if (!baseRow) return [];
  const baseline = JSON.parse(baseRow.snapshot_json);
  const current = compactSnapshot(await loadPlayer(member.rsn));
  const team = await teamOf(bingo.id, member.user_id);
  const completed = [];
  for (const tile of await tilesOf(bingo.id)) {
    if (!['wom_xp', 'wom_kc', 'wom_activity', 'wom_level'].includes(tile.verify_mode)) continue;
    const already = await db.prepare('SELECT status FROM bingo_progress WHERE bingo_id = ? AND tile_id = ? AND user_id = ?').get(bingo.id, tile.id, member.user_id);
    if (already?.status === 'complete') continue;
    const gained = tile.verify_mode === 'wom_level'
      ? metricValue(current, tile)
      : metricValue(current, tile) - metricValue(baseline, tile);
    const ok = tile.verify_mode === 'wom_level' ? gained >= (tile.amount || 99) : gained >= (tile.amount || 1);
    if (ok) {
      await markComplete({ bingo, tile, userId: member.user_id, teamId: team?.id, verifiedBy: 'wom', status: 'complete', client });
      completed.push(tile);
    }
  }
  return completed;
}

module.exports = {
  activeBingo,
  getBingo,
  tilesOf,
  createBingo,
  setTile,
  replaceTiles,
  applyTemplate,
  lastGuildBoard,
  copyTilesFrom,
  swapTiles,
  capacityOf,
  isEditable,
  isWomMode,
  progressOf,
  saveMessage,
  claimTile,
  checkWomTile,
  ensureBaseline,
  createTeam,
  joinTeam,
  teamOf,
  listTeams,
  boardEmbed,
  boardText,
  snapshotBaselines,
  markComplete,
  autoCheckMember,
  prettyMetric,
};
