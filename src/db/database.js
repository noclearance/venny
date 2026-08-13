const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DB_PATH = path.join(__dirname, '..', '..', 'data.db');

function resolveDbPath() {
  const fromEnv = (process.env.DB_PATH || '').trim();
  return fromEnv || DEFAULT_DB_PATH;
}

const DB_PATH = resolveDbPath();

let db;

function warnIfCloudSynced(dbPath) {
  if (/onedrive|dropbox|google drive/i.test(dbPath)) {
    console.warn('⚠️  Database is on a cloud-synced drive. SQLite + OneDrive/Dropbox can corrupt data.db.');
    console.warn('   Set DB_PATH in .env to a local folder, e.g. %LOCALAPPDATA%\\osrs-clan-bot\\data.db');
  }
}

function wrapStatement(stmt) {
  return {
    get: (...args) => stmt.get(...args),
    all: (...args) => stmt.all(...args),
    run: (...args) => {
      const result = stmt.run(...args) || {};
      return {
        lastInsertRowid: Number(result.lastInsertRowid ?? 0),
        changes: Number(result.changes ?? 0),
      };
    },
  };
}

function openDatabase(dbPath) {
  const raw = new DatabaseSync(dbPath, {
    enableForeignKeyConstraints: true,
    timeout: 5000,
  });
  raw.exec('PRAGMA journal_mode = WAL');
  return {
    exec: sql => raw.exec(sql),
    pragma: pragma => raw.exec(`PRAGMA ${pragma}`),
    prepare: sql => wrapStatement(raw.prepare(sql)),
  };
}

function getDb() {
  if (!db) {
    warnIfCloudSynced(DB_PATH);
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = openDatabase(DB_PATH);
  }
  return db;
}

function initDb() {
  const db = getDb();

  db.exec(`
    -- Guild settings (one row per Discord server)
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id       TEXT PRIMARY KEY,
      wom_group_id   INTEGER,
      wom_verif_code TEXT,
      reminder_channel TEXT,
      created_at     TEXT DEFAULT (datetime('now'))
    );

    -- Linked members: Discord user → OSRS RSN (via WOM)
    CREATE TABLE IF NOT EXISTS members (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      rsn        TEXT NOT NULL,
      wom_id     INTEGER,
      linked_at  TEXT DEFAULT (datetime('now')),
      UNIQUE(guild_id, user_id),
      UNIQUE(guild_id, rsn),
      FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id)
    );

    -- Clan events (scheduled gatherings, boss masses, etc.)
    CREATE TABLE IF NOT EXISTS events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id      TEXT NOT NULL,
      title         TEXT NOT NULL,
      description   TEXT,
      event_time    TEXT NOT NULL,
      channel_id    TEXT NOT NULL,
      created_by    TEXT NOT NULL,
      created_at    TEXT DEFAULT (datetime('now')),
      reminder_sent INTEGER DEFAULT 0,
      FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id)
    );

    -- Raffles
    CREATE TABLE IF NOT EXISTS raffles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id    TEXT NOT NULL,
      title       TEXT NOT NULL,
      description TEXT,
      channel_id  TEXT NOT NULL,
      created_by  TEXT NOT NULL,
      created_at  TEXT DEFAULT (datetime('now')),
      drawn       INTEGER DEFAULT 0,
      winner_id   TEXT,
      FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id)
    );

    -- Raffle entries
    CREATE TABLE IF NOT EXISTS raffle_entries (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      raffle_id  INTEGER NOT NULL,
      user_id    TEXT NOT NULL,
      entered_at TEXT DEFAULT (datetime('now')),
      UNIQUE(raffle_id, user_id),
      FOREIGN KEY (raffle_id) REFERENCES raffles(id) ON DELETE CASCADE
    );

    -- SOTW (Skill of the Week) competitions
    CREATE TABLE IF NOT EXISTS sotw (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id        TEXT NOT NULL,
      skill           TEXT NOT NULL,
      starts_at       TEXT NOT NULL,
      ends_at         TEXT NOT NULL,
      wom_competition_id INTEGER,
      channel_id      TEXT NOT NULL,
      created_by      TEXT NOT NULL,
      created_at      TEXT DEFAULT (datetime('now')),
      ended           INTEGER DEFAULT 0,
      winner_rsn      TEXT,
      FOREIGN KEY (guild_id) REFERENCES guild_settings(guild_id)
    );

    -- SOTW winners log (historical)
    CREATE TABLE IF NOT EXISTS sotw_winners (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id    TEXT NOT NULL,
      sotw_id     INTEGER NOT NULL,
      skill       TEXT NOT NULL,
      winner_rsn  TEXT NOT NULL,
      xp_gained   INTEGER,
      starts_at   TEXT NOT NULL,
      ends_at     TEXT NOT NULL,
      logged_at   TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (sotw_id) REFERENCES sotw(id) ON DELETE CASCADE
    );

    -- Polls (native Discord polls for SOTW/BOTW voting)
    CREATE TABLE IF NOT EXISTS polls (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id      TEXT NOT NULL,
      type          TEXT NOT NULL,  -- 'sotw', 'botw', 'generic'
      question      TEXT NOT NULL,
      channel_id    TEXT NOT NULL,
      message_id    TEXT,
      options_json  TEXT NOT NULL,  -- JSON array of option texts
      ends_at       TEXT NOT NULL,
      auto_start    INTEGER DEFAULT 0,  -- 1 = auto-start SOTW with winning skill
      sotw_duration INTEGER DEFAULT 7,  -- duration in days for auto-started SOTW
      finalized     INTEGER DEFAULT 0,
      winner        TEXT,
      created_by    TEXT NOT NULL,
      created_at    TEXT DEFAULT (datetime('now'))
    );
  `);

  // ── Migrations for existing databases ──────────────
  // CREATE TABLE IF NOT EXISTS won't add new columns to existing tables.
  migrateColumn(db, 'events', 'recurrence', 'TEXT DEFAULT "none"');       // 'none', 'weekly', 'monthly'
  migrateColumn(db, 'events', 'parent_event_id', 'INTEGER');             // original event ID for recurring chain
  migrateColumn(db, 'events', 'next_created', 'INTEGER DEFAULT 0');    // 1 = next occurrence already generated
  migrateColumn(db, 'guild_settings', 'audit_channel', 'TEXT');         // channel for action logging
  migrateColumn(db, 'guild_settings', 'timezone', 'TEXT');              // IANA timezone, e.g. 'America/New_York'
  migrateColumn(db, 'events', 'category', 'TEXT DEFAULT "general"');     // 'boss', 'pvm', 'skilling', 'social', 'general'
  migrateColumn(db, 'events', 'message_id', 'TEXT');                    // message ID for RSVP buttons
  migrateColumn(db, 'events', 'message_channel_id', 'TEXT');            // channel that holds the RSVP message
  migrateColumn(db, 'raffles', 'weight_mode', 'TEXT DEFAULT "none"');   // 'none', 'sotw', 'attendance', 'activity'
  migrateColumn(db, 'raffle_entries', 'weight', 'INTEGER DEFAULT 1');   // weight multiplier for weighted raffles
  migrateColumn(db, 'raffle_entries', 'weight_reason', 'TEXT');         // why this weight was assigned

  // ── New tables for v2 features ──────────────────────
  db.exec(`
    -- Event subscriptions (DB-based, optional role support)
    CREATE TABLE IF NOT EXISTS event_subscriptions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      category   TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(guild_id, user_id, category)
    );

    -- Optional role mapping for event categories
    CREATE TABLE IF NOT EXISTS event_roles (
      guild_id   TEXT NOT NULL,
      category   TEXT NOT NULL,
      role_id    TEXT NOT NULL,
      PRIMARY KEY (guild_id, category)
    );

    -- Event attendance (RSVP)
    CREATE TABLE IF NOT EXISTS event_attendance (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id   INTEGER NOT NULL,
      user_id    TEXT NOT NULL,
      status     TEXT NOT NULL,  -- 'yes', 'maybe', 'no'
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(event_id, user_id),
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    -- SOTW queue (upcoming SOTWs to auto-start)
    CREATE TABLE IF NOT EXISTS sotw_queue (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id      TEXT NOT NULL,
      skill         TEXT NOT NULL,
      title         TEXT,
      duration_days INTEGER DEFAULT 7,
      channel_id    TEXT NOT NULL,
      created_by    TEXT NOT NULL,
      source_poll_id INTEGER,
      created_at    TEXT DEFAULT (datetime('now')),
      started_at    TEXT,
      cancelled     INTEGER DEFAULT 0
    );

    -- Clan players synced from WOM (RSN → WOM ID, not Discord-linked)
    CREATE TABLE IF NOT EXISTS clan_players (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id        TEXT NOT NULL,
      rsn             TEXT NOT NULL,
      wom_id          INTEGER,
      role            TEXT,
      last_synced_at  TEXT,
      UNIQUE(guild_id, rsn)
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

    CREATE TABLE IF NOT EXISTS bingo_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id      TEXT NOT NULL,
      title         TEXT NOT NULL,
      theme         TEXT NOT NULL,
      size          INTEGER NOT NULL,
      status        TEXT NOT NULL DEFAULT 'draft',
      channel_id    TEXT,
      message_id    TEXT,
      created_by    TEXT NOT NULL,
      created_at    TEXT DEFAULT (datetime('now')),
      started_at    TEXT,
      ended_at      TEXT,
      last_progress_post TEXT
    );

    CREATE TABLE IF NOT EXISTS bingo_tiles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      bingo_id    INTEGER NOT NULL,
      slot        INTEGER NOT NULL,
      label       TEXT NOT NULL,
      verify_mode TEXT NOT NULL,
      metric      TEXT,
      amount      INTEGER,
      UNIQUE(bingo_id, slot),
      FOREIGN KEY (bingo_id) REFERENCES bingo_events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bingo_teams (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      bingo_id   INTEGER NOT NULL,
      name       TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(bingo_id, name),
      FOREIGN KEY (bingo_id) REFERENCES bingo_events(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bingo_team_members (
      team_id   INTEGER NOT NULL,
      user_id   TEXT NOT NULL,
      joined_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (team_id, user_id),
      FOREIGN KEY (team_id) REFERENCES bingo_teams(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bingo_progress (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      bingo_id    INTEGER NOT NULL,
      tile_id     INTEGER NOT NULL,
      user_id     TEXT NOT NULL,
      team_id     INTEGER,
      status      TEXT NOT NULL DEFAULT 'pending',
      proof       TEXT,
      verified_by TEXT,
      completed_at TEXT,
      UNIQUE(bingo_id, tile_id, user_id),
      FOREIGN KEY (bingo_id) REFERENCES bingo_events(id) ON DELETE CASCADE,
      FOREIGN KEY (tile_id) REFERENCES bingo_tiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bingo_baselines (
      bingo_id     INTEGER NOT NULL,
      user_id      TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      taken_at     TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (bingo_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS achievements (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      rsn        TEXT,
      key        TEXT NOT NULL,
      title      TEXT NOT NULL,
      kind       TEXT NOT NULL,
      announced  INTEGER DEFAULT 0,
      earned_at  TEXT DEFAULT (datetime('now')),
      UNIQUE(guild_id, user_id, key)
    );

    CREATE TABLE IF NOT EXISTS xp_goals (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      kind       TEXT NOT NULL,
      skill      TEXT,
      target     INTEGER NOT NULL,
      reached    INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      reached_at TEXT
    );

    CREATE TABLE IF NOT EXISTS economy_balances (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      coins    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS economy_ledger (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      amount     INTEGER NOT NULL,
      reason     TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS profile_cache (
      guild_id    TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      rsn         TEXT,
      payload     TEXT NOT NULL,
      fetched_at  TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS live_embeds (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id    TEXT NOT NULL,
      kind        TEXT NOT NULL,
      ref_id      TEXT,
      channel_id  TEXT NOT NULL,
      message_id  TEXT NOT NULL,
      UNIQUE(guild_id, kind, ref_id)
    );

    CREATE TABLE IF NOT EXISTS incoming_webhooks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT NOT NULL,
      name       TEXT NOT NULL,
      token      TEXT NOT NULL UNIQUE,
      channel_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS botw (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT NOT NULL,
      boss       TEXT NOT NULL,
      starts_at  TEXT NOT NULL,
      ends_at    TEXT NOT NULL,
      channel_id TEXT,
      created_by TEXT,
      ended      INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_bingo_guild ON bingo_events(guild_id, status);
    CREATE INDEX IF NOT EXISTS idx_achievements_guild ON achievements(guild_id, earned_at);
    CREATE INDEX IF NOT EXISTS idx_goals_open ON xp_goals(guild_id, reached);
    CREATE INDEX IF NOT EXISTS idx_economy_guild ON economy_balances(guild_id, coins);
  `);

  migrateColumn(db, 'guild_settings', 'announce_channel', 'TEXT');
  migrateColumn(db, 'sotw', 'standings_message_id', 'TEXT');
  migrateColumn(db, 'sotw', 'standings_channel_id', 'TEXT');
  migrateColumn(db, 'bingo_events', 'layout', 'TEXT DEFAULT "grid"');
  migrateColumn(db, 'bingo_tiles', 'notes', 'TEXT');
  migrateColumn(db, 'bingo_tiles', 'points', 'INTEGER DEFAULT 1');
  migrateColumn(db, 'raffles', 'ticket_gp', 'INTEGER DEFAULT 150000');

  console.log('Database initialized at', DB_PATH);
  return db;
}

// Add a column to a table if it doesn't already exist (safe for upgrading existing DBs)
function migrateColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`  Migration: added ${column} to ${table}`);
  }
}

module.exports = { getDb, initDb, DB_PATH };
