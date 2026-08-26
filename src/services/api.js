// HTTP API on the same process as Discord.
// Grok / dashboards call these. Slash commands stay on Discord.
// Do not split this into a second Render worker — two logins = Unknown interaction.

const { PermissionFlagsBits } = require('discord.js');
const { getDb } = require('../db/database');
const theme = require('./theme');
const { clanRankNames } = require('./ranks');

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

function discordNameForRank(rank) {
  const key = String(rank || '').trim().toLowerCase();
  return clanRankNames()[key] || String(rank || '').trim();
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
  const name = discordNameForRank(body.rank || body.role || body.name);
  if (!name) throw new Error('discord_id and rank required');
  const roles = await guild.roles.fetch();
  const role = roles.find(r => r.name.toLowerCase() === name.toLowerCase());
  if (!role) throw new Error(`no Discord role named "${name}"`);
  return role;
}

function clanRankRoleIds(guild) {
  const names = new Set(Object.values(clanRankNames()).map(n => n.toLowerCase()));
  return guild.roles.cache.filter(r => names.has(r.name.toLowerCase()));
}

function extraStripIds(body) {
  const raw = body.rank_role_ids || body.rankRoleIds || body.remove_role_ids || body.removeRoleIds || [];
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  return new Set(list.map(snowflake).filter(Boolean));
}

async function syncRank(client, body) {
  if (!client?.isReady?.()) throw new Error('discord offline');
  const guildId = guildIdFrom(body);
  if (!guildId) throw new Error('guild_id missing (set GUILD_ID or pass guild_id)');
  const userId = snowflake(body.discord_id || body.user_id || body.discordId || body.userId);
  if (!userId) throw new Error('discord_id required');

  const guild = await client.guilds.fetch(guildId);
  await guild.roles.fetch();
  const me = guild.members.me;
  if (!me?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error('Venny needs Manage Roles. Run `/config ranks` and drag Venny above Trial/Member/Veteran/Officer/Admin.');
  }
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throw new Error('that Discord user is not in this server');

  const role = await resolveRole(guild, body);
  if (me.roles.highest.comparePositionTo(role) <= 0) {
    throw new Error(`Venny’s role is not above **${role.name}**. Server Settings → Roles → drag Venny up. \`/config ranks\` shows the list.`);
  }
  const reason = String(body.reason || `Hub rank sync: ${role.name}`).slice(0, 200);
  const exclusive = body.exclusive !== false;
  const removed = [];

  if (exclusive) {
    const extra = extraStripIds(body);
    const gone = member.roles.cache.filter(r => (
      r.id !== role.id && (clanRankRoleIds(guild).has(r.id) || extra.has(r.id))
    ));
    if (gone.size) {
      await member.roles.remove(gone, reason);
      for (const r of gone.values()) removed.push({ id: r.id, name: r.name });
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

module.exports = { handleApi, preflight, syncRank, readBearer, looksLikeDiscordBotToken, apiToken, corsOrigins };
