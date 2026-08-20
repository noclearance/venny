// HTTP API on the same process as Discord.
// Grok / dashboards call these. Slash commands stay on Discord.
// Do not split this into a second Render worker — two logins = Unknown interaction.

const { getDb } = require('../db/database');
const theme = require('./theme');

function json(res, status, body) {
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
    json(res, 503, { error: 'API_TOKEN is not set on Render.' });
    return false;
  }
  if (!tokensMatch(readBearer(req), expected)) {
    json(res, 401, { error: 'bad token' });
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

  const posted = await require('./announce').broadcast(client, guildId, {
    kind: 'brand',
    job: 'event_start',
    facts: { title, staffNotes: description },
    card: { title, description },
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
  const card = await require('./flavor').write({
    job: 'leaderboard_gained',
    facts: { skill, period, count: top.length },
  });
  const posted = await require('./announce').broadcast(client, guildId, {
    kind: 'sotw',
    job: 'leaderboard_gained',
    card: {
      title: card.title,
      description: [card.description, board].filter(Boolean).join('\n\n'),
      color: card.color,
    },
  });
  if (!posted) throw new Error('no announce channel — /config announce-channel');
  return { id: posted.id, channel_id: posted.channelId, rows: top.length };
}

async function handleApi(req, res, client) {
  const url = (req.url || '/').split('?')[0];
  const method = req.method;

  if (method === 'GET' && url === '/api/status') {
    json(res, 200, await status(client));
    return true;
  }

  if (method === 'POST' && url === '/api/announce') {
    if (!requireToken(req, res)) return true;
    try {
      const body = await readBody(req);
      const out = await postAnnounce(client, body);
      json(res, 200, { ok: true, ...out });
    } catch (err) {
      json(res, 400, { error: err.message });
    }
    return true;
  }

  if (method === 'POST' && url === '/api/osrs/daily-summary') {
    if (!requireToken(req, res)) return true;
    try {
      const body = await readBody(req);
      const out = await dailySummary(client, body);
      json(res, 200, { ok: true, ...out });
    } catch (err) {
      json(res, 400, { error: err.message });
    }
    return true;
  }

  if (method === 'POST' && url === '/api/bot/restart') {
    if (!requireToken(req, res)) return true;
    json(res, 200, { ok: true, restarting: true });
    setTimeout(() => process.exit(1), 150);
    return true;
  }

  return false;
}

module.exports = { handleApi };
