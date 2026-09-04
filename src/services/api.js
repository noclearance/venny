// HTTP API on the same process as Discord.
// Grok / dashboards call these. Slash commands stay on Discord.
// Do not split this into a second Render worker — two logins = Unknown interaction.

const { getDb } = require('../db/database');
const theme = require('./theme');
const ranks = require('./ranks');

const DEFAULT_CORS = [
  'https://misclickerz.ai.studio',
  'https://misclickerz-hub.base44.app',
];

function corsOrigins() {
  const extra = String(process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return [...new Set([...DEFAULT_CORS, ...extra])];
}

function allowOrigin(req) {
  const origin = String(req.headers.origin || '');
  const allowed = corsOrigins();
  if (origin && allowed.includes(origin)) return origin;
  return allowed[0];
}

function setCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', allowOrigin(req));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, x-venny-key, x-api-key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function preflight(req, res) {
  setCors(req, res);
  res.writeHead(204).end();
}

function json(req, res, status, body) {
  setCors(req, res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function looksLikeDiscordBotToken(value) {
  const v = String(value || '').trim();
  if (!v) return false;
  const discord = (process.env.DISCORD_TOKEN || '').trim();
  if (discord && v === discord) return true;
  return /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{20,}$/.test(v);
}

let warnedDiscordAsApi = false;

function apiToken() {
  const raw = (process.env.API_TOKEN || process.env.GROK_API_TOKEN || '').trim();
  if (!raw) return '';
  if (looksLikeDiscordBotToken(raw)) {
    if (!warnedDiscordAsApi) {
      warnedDiscordAsApi = true;
      console.warn('API_TOKEN is your Discord bot token. Make up a separate password for Base44 VITE_BOT_API_TOKEN and Render API_TOKEN.');
    }
    return '';
  }
  return raw;
}

function readBearer(req) {
  const header = String(req.headers.authorization || '');
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return String(req.headers['x-venny-key'] || req.headers['x-api-key'] || '').trim();
}

function tokensMatch(got, expected) {
  if (!expected || !got || got.length !== expected.length) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return require('crypto').timingSafeEqual(a, b);
}

function requireToken(req, res) {
  const expected = apiToken();
  if (!expected) {
    const mixed = looksLikeDiscordBotToken(process.env.API_TOKEN || process.env.GROK_API_TOKEN || '');
    json(req, res, 503, {
      error: mixed
        ? 'API_TOKEN is your Discord bot token — make up a separate password for Render API_TOKEN and Base44 VITE_BOT_API_TOKEN.'
        : 'API_TOKEN is not set on Render.',
    });
    return false;
  }
  if (!tokensMatch(readBearer(req), expected)) {
    json(req, res, 401, { error: 'bad token' });
    return false;
  }
  return true;
}

function readBody(req, limit = 80_000) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > limit) {
        req.destroy();
        reject(new Error('payload too large'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function guildIdFrom(body) {
  return String(body?.guild_id || process.env.GUILD_ID || process.env.CLAN_GUILD_ID || '').trim();
}

function guildIdFromReq(req, body = {}) {
  let q = '';
  try {
    q = new URL(req.url || '/', 'http://venny.local').searchParams.get('guild_id') || '';
  } catch { /* ignore */ }
  return String(q || guildIdFrom(body)).trim();
}

function clipRow(row, keys) {
  if (!row) return null;
  const out = {};
  for (const k of keys) out[k] = row[k] ?? null;
  return out;
}

async function clanNow(guildId) {
  const db = getDb();
  const now = new Date().toISOString();
  const { MASS } = require('./calendar');
  const sotw = await db.prepare(
    'SELECT id, skill, starts_at, ends_at, prize, wom_competition_id FROM sotw WHERE guild_id = ? AND ended = 0 ORDER BY id DESC',
  ).get(guildId);
  const botw = await db.prepare(
    'SELECT id, boss, starts_at, ends_at, prize FROM botw WHERE guild_id = ? AND ended = 0 ORDER BY id DESC',
  ).get(guildId);
  const nextMass = await db.prepare(
    `SELECT id, title, description, event_time, category, channel_id FROM events WHERE guild_id = ? AND event_time >= ? AND ${MASS} ORDER BY event_time ASC`,
  ).get(guildId, now);
  const raffles = await db.prepare(
    'SELECT id, title, description, ends_at, drawn FROM raffles WHERE guild_id = ? AND drawn = 0 ORDER BY id DESC',
  ).all(guildId);
  const { stillOpen } = require('./raffleRun');
  const raffle = (raffles || []).find(r => stillOpen(r)) || null;
  const bingo = await db.prepare(
    "SELECT id, title, status, size, layout FROM bingo_events WHERE guild_id = ? AND status = 'active' ORDER BY id DESC",
  ).get(guildId);
  return {
    guild_id: guildId,
    sotw: clipRow(sotw, ['id', 'skill', 'starts_at', 'ends_at', 'prize', 'wom_competition_id']),
    botw: clipRow(botw, ['id', 'boss', 'starts_at', 'ends_at', 'prize']),
    next_mass: clipRow(nextMass, ['id', 'title', 'description', 'event_time', 'category', 'channel_id']),
    raffle: raffle ? clipRow(raffle, ['id', 'title', 'description', 'ends_at']) : null,
    bingo: clipRow(bingo, ['id', 'title', 'status', 'size', 'layout']),
    ts: now,
  };
}

async function clanMembers(client, guildId) {
  const db = getDb();
  const rows = await db.prepare('SELECT user_id, rsn FROM members WHERE guild_id = ? ORDER BY rsn').all(guildId);
  const list = (rows || []).map(r => ({ discord_id: r.user_id, rsn: r.rsn, rank: null }));
  if (!client?.isReady?.() || !list.length) return { guild_id: guildId, members: list };
  try {
    const guild = await client.guilds.fetch(guildId);
    await guild.roles.fetch();
    await guild.members.fetch().catch(() => {});
    for (const row of list) {
      const member = guild.members.cache.get(row.discord_id);
      if (member) row.rank = ranks.currentKey(member) || null;
    }
  } catch (err) {
    console.warn(`clan members ranks: ${err.message}`);
  }
  return { guild_id: guildId, members: list };
}

function clanRanks() {
  return {
    order: ranks.ORDER,
    names: ranks.clanRankNames(),
    aliases: ranks.HUB_ALIAS,
  };
}

async function status(client) {
  return {
    ok: Boolean(client?.isReady?.()),
    discord: Boolean(client?.isReady?.()),
    openai: Boolean((process.env.OPENAI_API_KEY || '').trim()),
    postgres: Boolean((process.env.DATABASE_URL || '').trim()),
    uptime_s: Math.round(process.uptime()),
  };
}

async function postAnnounce(client, body) {
  const guildId = guildIdFrom(body);
  if (!guildId) throw new Error('guild_id missing (set GUILD_ID or pass guild_id)');
  const title = String(body.title || 'Clan board').slice(0, 200);
  const description = String(body.description || body.summary || body.content || body.message || '').slice(0, 1800);
  if (!description) throw new Error('description / summary / content required');

  if (body.channel_id) {
    const channel = await client.channels.fetch(String(body.channel_id));
    if (!channel) throw new Error('channel_id not found');
    if (String(channel.guild?.id || '') !== guildId) throw new Error('channel_id is not in this guild');
    const sent = await channel.send({
      embeds: [theme.embed('brand', { title, description, timestamp: true })],
    });
    return { id: sent.id, channel_id: sent.channelId };
  }

  const posted = await require('./cards').publish(client, guildId, {
    kind: 'brand',
    json: { title, description, source: 'api' },
  });
  if (!posted) throw new Error('no announce channel — /config announce-channel');
  return { id: posted.id, channel_id: posted.channelId };
}

async function dailySummary(client, body) {
  const guildId = guildIdFrom(body);
  if (!guildId) throw new Error('guild_id missing (set GUILD_ID or pass guild_id)');
  const settings = await getDb().prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
  if (!settings?.wom_group_id) throw new Error('WOM group not set — /config wom-group');

  const wom = require('./wom');
  const skill = String(body.skill || 'overall');
  const period = String(body.period || 'day');
  const gained = await wom.getGroupGained(settings.wom_group_id, skill, period, 10);
  const top = (gained || []).slice(0, 10);
  const board = theme.rankLines(top, entry => `**${entry.player.displayName}** — +${entry.data.gained.toLocaleString()} XP`);
  const made = await require('./cards').make('sotw', {
    job: 'leaderboard_gained',
    facts: { skill, period, count: top.length },
    extraLines: [board],
  });
  const posted = await require('./cards').publish(client, guildId, {
    kind: 'sotw',
    json: made.json,
  });
  if (!posted) throw new Error('no announce channel — /config announce-channel');
  return { id: posted.id, channel_id: posted.channelId, rows: top.length };
}

function snowflake(value) {
  const id = String(value || '').trim();
  if (!/^\d{5,32}$/.test(id)) return '';
  return id;
}

async function resolveRole(guild, body) {
  const roleId = snowflake(body.role_id || body.roleId);
  if (roleId) {
    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (!role) throw new Error('role_id is not a role on this server');
    return role;
  }
  const name = ranks.discordNameForRank(body.rank || body.role || body.name);
  if (!name) throw new Error('discord_id and rank required');
  const roles = await guild.roles.fetch();
  const role = roles.find(r => r.name.toLowerCase() === name.toLowerCase());
  if (!role) throw new Error(`no Discord role named "${name}"`);
  return role;
}

function extraStripIds(body) {
  const raw = body.rank_role_ids || body.rankRoleIds || body.remove_role_ids || body.removeRoleIds || [];
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  return new Set(list.map(snowflake).filter(Boolean));
}

async function syncRank(client, body) {
  const guildId = guildIdFrom(body);
  if (!guildId) throw new Error('guild_id missing (set GUILD_ID or pass guild_id)');
  const userId = snowflake(body.discord_id || body.user_id || body.discordId || body.userId);
  if (!userId) throw new Error('discord_id required');
  const rank = body.rank || body.role || body.name;
  if (!rank && !(body.role_id || body.roleId)) throw new Error('discord_id and rank required');
  let name = rank;
  if (body.role_id || body.roleId) {
    const guild = await client.guilds.fetch(guildId);
    name = (await resolveRole(guild, body)).name;
  }
  if (!ranks.resolveKey(name)) throw new Error('unknown clan rank');
  return ranks.applyRank(client, guildId, userId, name, {
    reason: body.reason || 'Hub rank sync',
    exclusive: body.exclusive !== false,
    extraStrip: extraStripIds(body),
  });
}

async function handleApi(req, res, client) {
  const url = (req.url || '/').split('?')[0];
  const method = req.method;

  if (method === 'OPTIONS' && url.startsWith('/api/')) {
    preflight(req, res);
    return true;
  }

  if (method === 'GET' && url === '/api/status') {
    json(req, res, 200, { ...(await status(client)), sync_rank: true, clan_now: true });
    return true;
  }

  if (method === 'GET' && url === '/api/clan/now') {
    if (!requireToken(req, res)) return true;
    const guildId = guildIdFromReq(req);
    if (!guildId) {
      json(req, res, 400, { error: 'guild_id missing (set GUILD_ID or pass ?guild_id=)' });
      return true;
    }
    try {
      json(req, res, 200, await clanNow(guildId));
    } catch (err) {
      json(req, res, 400, { error: err.message });
    }
    return true;
  }

  if (method === 'GET' && url === '/api/clan/members') {
    if (!requireToken(req, res)) return true;
    const guildId = guildIdFromReq(req);
    if (!guildId) {
      json(req, res, 400, { error: 'guild_id missing (set GUILD_ID or pass ?guild_id=)' });
      return true;
    }
    try {
      json(req, res, 200, await clanMembers(client, guildId));
    } catch (err) {
      json(req, res, 400, { error: err.message });
    }
    return true;
  }

  if (method === 'GET' && url === '/api/clan/ranks') {
    if (!requireToken(req, res)) return true;
    json(req, res, 200, clanRanks());
    return true;
  }

  if (method === 'POST' && url === '/api/announce') {
    if (!requireToken(req, res)) return true;
    try {
      const body = await readBody(req);
      const out = await postAnnounce(client, body);
      json(req, res, 200, { ok: true, ...out });
    } catch (err) {
      json(req, res, 400, { error: err.message });
    }
    return true;
  }

  if (method === 'POST' && url === '/api/osrs/daily-summary') {
    if (!requireToken(req, res)) return true;
    try {
      const body = await readBody(req);
      const out = await dailySummary(client, body);
      json(req, res, 200, { ok: true, ...out });
    } catch (err) {
      json(req, res, 400, { error: err.message });
    }
    return true;
  }

  if (method === 'POST' && url === '/api/sync-rank') {
    if (!requireToken(req, res)) return true;
    try {
      const body = await readBody(req);
      const out = await syncRank(client, body);
      json(req, res, 200, out);
    } catch (err) {
      const msg = err.message || String(err);
      const code = /offline/i.test(msg) ? 503 : /not in this server/i.test(msg) ? 404 : 400;
      json(req, res, code, { error: msg });
    }
    return true;
  }

  if (method === 'POST' && url === '/api/bot/restart') {
    if (!requireToken(req, res)) return true;
    json(req, res, 200, { ok: true, restarting: true });
    setTimeout(() => process.exit(1), 150);
    return true;
  }

  return false;
}

module.exports = {
  handleApi,
  preflight,
  syncRank,
  readBearer,
  looksLikeDiscordBotToken,
  apiToken,
  corsOrigins,
  clanNow,
  clanRanks,
};
