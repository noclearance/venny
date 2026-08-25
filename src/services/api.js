// HTTP API on the same process as Discord.
// Grok / dashboards call these. Slash commands stay on Discord.
// Do not split this into a second Render worker — two logins = Unknown interaction.

const { getDb } = require('../db/database');
const theme = require('./theme');

const DEFAULT_CORS = 'https://misclickerz-hub.base44.app';

function corsOrigins() {
  const extra = String(process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return [...new Set([DEFAULT_CORS, ...extra])];
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

function apiToken() {
  return (process.env.API_TOKEN || process.env.GROK_API_TOKEN || '').trim();
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
    json(req, res, 503, { error: 'API_TOKEN is not set on Render.' });
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
  return String(body?.guild_id || process.env.GUILD_ID || '').trim();
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
  const name = String(body.rank || body.role || body.name || '').trim();
  if (!name) throw new Error('rank or role_id required');
  const roles = await guild.roles.fetch();
  const role = roles.find(r => r.name.toLowerCase() === name.toLowerCase());
  if (!role) throw new Error(`no Discord role named "${name}"`);
  return role;
}

function stripIds(body, keepId) {
  const raw = body.rank_role_ids || body.rankRoleIds || body.remove_role_ids || body.removeRoleIds || [];
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  const ids = new Set(list.map(snowflake).filter(Boolean));
  ids.delete(String(keepId));
  return ids;
}

async function syncRank(client, body) {
  if (!client?.isReady?.()) throw new Error('discord offline');
  const guildId = guildIdFrom(body);
  if (!guildId) throw new Error('guild_id missing (set GUILD_ID or pass guild_id)');
  const userId = snowflake(body.discord_id || body.user_id || body.discordId || body.userId);
  if (!userId) throw new Error('discord_id required');

  const guild = await client.guilds.fetch(guildId);
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throw new Error('that Discord user is not in this server');

  const role = await resolveRole(guild, body);
  const reason = String(body.reason || `Hub rank sync: ${role.name}`).slice(0, 200);
  const exclusive = body.exclusive !== false;
  const removed = [];

  if (exclusive) {
    const strip = stripIds(body, role.id);
    if (strip.size) {
      const gone = member.roles.cache.filter(r => strip.has(r.id));
      if (gone.size) {
        await member.roles.remove(gone, reason);
        for (const r of gone.values()) removed.push({ id: r.id, name: r.name });
      }
    }
  }

  if (!member.roles.cache.has(role.id)) {
    await member.roles.add(role, reason);
  }

  await require('./audit').audit(
    client,
    guildId,
    `Hub rank **${role.name}** on <@${userId}>`,
  );

  return {
    ok: true,
    discord_id: userId,
    rank: role.name,
    role_id: role.id,
    added: true,
    removed,
  };
}

async function handleApi(req, res, client) {
  const url = (req.url || '/').split('?')[0];
  const method = req.method;

  if (method === 'OPTIONS' && url.startsWith('/api/')) {
    preflight(req, res);
    return true;
  }

  if (method === 'GET' && url === '/api/status') {
    json(req, res, 200, { ...(await status(client)), sync_rank: true });
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

module.exports = { handleApi, preflight, syncRank };
