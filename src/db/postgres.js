const { Pool } = require('pg');
const { translateSql, coerceRow } = require('./sql');

let pool;

function getPool() {
  if (!pool) {
    const url = (process.env.DATABASE_URL || '').trim();
    pool = new Pool({
      connectionString: url,
      ssl: url.includes('localhost') || url.includes('127.0.0.1')
        ? false
        : { rejectUnauthorized: false },
      max: 8,
    });
  }
  return pool;
}

function wrapPg() {
  const p = getPool();
  return {
    kind: 'postgres',
    exec: async sql => {
      await p.query(sql);
    },
    prepare(sql) {
      return {
        get: async (...args) => {
          const res = await p.query(translateSql(sql), args);
          return coerceRow(res.rows[0]);
        },
        all: async (...args) => {
          const res = await p.query(translateSql(sql), args);
          return res.rows.map(coerceRow);
        },
        run: async (...args) => {
          let q = translateSql(sql);
          const inserting = /^\s*INSERT/i.test(sql) && !/RETURNING/i.test(q);
          // Some tables use guild_id as the PK and have no `id` column.
          if (inserting) q = `${q.replace(/;?\s*$/, '')} RETURNING *`;
          const res = await p.query(q, args);
          const row = res.rows[0] || {};
          return {
            lastInsertRowid: Number(row.id ?? 0),
            changes: Number(res.rowCount ?? 0),
          };
        },
      };
    },
  };
}

async function columnExists(table, column) {
  const res = await getPool().query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return res.rowCount > 0;
}

async function migrateColumn(db, table, column, definition) {
  if (await columnExists(table, column)) return;
  const def = String(definition).replace(/DEFAULT\s+"([^"]+)"/g, "DEFAULT '$1'");
  await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  console.log(`  Migration: added ${column} to ${table}`);
}

async function initPostgres(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      wom_group_id INTEGER,
      wom_verif_code TEXT,
      reminder_channel TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS members (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      rsn TEXT NOT NULL,
      wom_id INTEGER,
      linked_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (guild_id, user_id),
      UNIQUE (guild_id, rsn)
    );
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      event_time TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      reminder_sent INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS raffles (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      channel_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      drawn INTEGER DEFAULT 0,
      winner_id TEXT
    );
    CREATE TABLE IF NOT EXISTS raffle_entries (
      id SERIAL PRIMARY KEY,
      raffle_id INTEGER NOT NULL REFERENCES raffles(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      entered_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (raffle_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS sotw (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      skill TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      wom_competition_id INTEGER,
      channel_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      ended INTEGER DEFAULT 0,
      winner_rsn TEXT
    );
    CREATE TABLE IF NOT EXISTS sotw_winners (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      sotw_id INTEGER NOT NULL REFERENCES sotw(id) ON DELETE CASCADE,
      skill TEXT NOT NULL,
      winner_rsn TEXT NOT NULL,
      xp_gained INTEGER,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      logged_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS polls (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      type TEXT NOT NULL,
      question TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      options_json TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      auto_start INTEGER DEFAULT 0,
      sotw_duration INTEGER DEFAULT 7,
      finalized INTEGER DEFAULT 0,
      winner TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS event_subscriptions (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (guild_id, user_id, category)
    );
    CREATE TABLE IF NOT EXISTS event_roles (
      guild_id TEXT NOT NULL,
      category TEXT NOT NULL,
      role_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, category)
    );
    CREATE TABLE IF NOT EXISTS event_attendance (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (event_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS sotw_queue (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      skill TEXT NOT NULL,
      title TEXT,
      duration_days INTEGER DEFAULT 7,
      channel_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      source_poll_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT,
      cancelled INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS clan_players (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      rsn TEXT NOT NULL,
      wom_id INTEGER,
      role TEXT,
      last_synced_at TEXT,
      UNIQUE (guild_id, rsn)
    );
    CREATE TABLE IF NOT EXISTS bingo_events (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      title TEXT NOT NULL,
      theme TEXT NOT NULL,
      size INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      channel_id TEXT,
      message_id TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT,
      ended_at TEXT,
      last_progress_post TEXT
    );
    CREATE TABLE IF NOT EXISTS bingo_tiles (
      id SERIAL PRIMARY KEY,
      bingo_id INTEGER NOT NULL REFERENCES bingo_events(id) ON DELETE CASCADE,
      slot INTEGER NOT NULL,
      label TEXT NOT NULL,
      verify_mode TEXT NOT NULL,
      metric TEXT,
      amount INTEGER,
      UNIQUE (bingo_id, slot)
    );
    CREATE TABLE IF NOT EXISTS bingo_teams (
      id SERIAL PRIMARY KEY,
      bingo_id INTEGER NOT NULL REFERENCES bingo_events(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (bingo_id, name)
    );
    CREATE TABLE IF NOT EXISTS bingo_team_members (
      team_id INTEGER NOT NULL REFERENCES bingo_teams(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (team_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS bingo_progress (
      id SERIAL PRIMARY KEY,
      bingo_id INTEGER NOT NULL REFERENCES bingo_events(id) ON DELETE CASCADE,
      tile_id INTEGER NOT NULL REFERENCES bingo_tiles(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      team_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      proof TEXT,
      verified_by TEXT,
      completed_at TEXT,
      UNIQUE (bingo_id, tile_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS bingo_baselines (
      bingo_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      taken_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (bingo_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS achievements (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      rsn TEXT,
      key TEXT NOT NULL,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      announced INTEGER DEFAULT 0,
      earned_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (guild_id, user_id, key)
    );
    CREATE TABLE IF NOT EXISTS xp_goals (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      skill TEXT,
      target INTEGER NOT NULL,
      reached INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      reached_at TEXT
    );
    CREATE TABLE IF NOT EXISTS economy_balances (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      coins INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS economy_ledger (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS profile_cache (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      rsn TEXT,
      payload TEXT NOT NULL,
      fetched_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS live_embeds (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      ref_id TEXT,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      UNIQUE (guild_id, kind, ref_id)
    );
    CREATE TABLE IF NOT EXISTS incoming_webhooks (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      channel_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS botw (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      boss TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      channel_id TEXT,
      created_by TEXT,
      ended INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_members_guild ON members(guild_id);
    CREATE INDEX IF NOT EXISTS idx_events_guild_time ON events(guild_id, event_time);
    CREATE INDEX IF NOT EXISTS idx_events_reminder ON events(reminder_sent, event_time);
    CREATE INDEX IF NOT EXISTS idx_raffles_guild ON raffles(guild_id);
    CREATE INDEX IF NOT EXISTS idx_sotw_guild_ended ON sotw(guild_id, ended);
    CREATE INDEX IF NOT EXISTS idx_polls_finalized ON polls(finalized, ends_at);
    CREATE INDEX IF NOT EXISTS idx_attendance_event ON event_attendance(event_id);
    CREATE INDEX IF NOT EXISTS idx_subs_guild_cat ON event_subscriptions(guild_id, category);
    CREATE INDEX IF NOT EXISTS idx_sotw_queue_guild ON sotw_queue(guild_id, started_at, cancelled);
    CREATE INDEX IF NOT EXISTS idx_raffle_entries_raffle ON raffle_entries(raffle_id);
    CREATE INDEX IF NOT EXISTS idx_bingo_guild ON bingo_events(guild_id, status);
    CREATE INDEX IF NOT EXISTS idx_achievements_guild ON achievements(guild_id, earned_at);
    CREATE INDEX IF NOT EXISTS idx_goals_open ON xp_goals(guild_id, reached);
    CREATE INDEX IF NOT EXISTS idx_economy_guild ON economy_balances(guild_id, coins);
  `);

  await migrateColumn(db, 'events', 'recurrence', "TEXT DEFAULT 'none'");
  await migrateColumn(db, 'events', 'parent_event_id', 'INTEGER');
  await migrateColumn(db, 'events', 'next_created', 'INTEGER DEFAULT 0');
  await migrateColumn(db, 'guild_settings', 'audit_channel', 'TEXT');
  await migrateColumn(db, 'guild_settings', 'timezone', 'TEXT');
  await migrateColumn(db, 'events', 'category', "TEXT DEFAULT 'general'");
  await migrateColumn(db, 'events', 'message_id', 'TEXT');
  await migrateColumn(db, 'events', 'message_channel_id', 'TEXT');
  await migrateColumn(db, 'raffles', 'weight_mode', "TEXT DEFAULT 'none'");
  await migrateColumn(db, 'raffle_entries', 'weight', 'INTEGER DEFAULT 1');
  await migrateColumn(db, 'raffle_entries', 'weight_reason', 'TEXT');
  await migrateColumn(db, 'guild_settings', 'announce_channel', 'TEXT');
  await migrateColumn(db, 'sotw', 'standings_message_id', 'TEXT');
  await migrateColumn(db, 'sotw', 'standings_channel_id', 'TEXT');
  await migrateColumn(db, 'bingo_events', 'layout', "TEXT DEFAULT 'grid'");
  await migrateColumn(db, 'bingo_tiles', 'notes', 'TEXT');
  await migrateColumn(db, 'bingo_tiles', 'points', 'INTEGER DEFAULT 1');
  await migrateColumn(db, 'raffles', 'ticket_gp', 'INTEGER DEFAULT 150000');
}

module.exports = { wrapPg, initPostgres, getPool };
