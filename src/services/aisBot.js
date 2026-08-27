// Outbound hub ingest. No-op without BOT_SECRET. Never throws into Discord commands.

const DEFAULT_BASE = 'https://misclickerz.ai.studio/api/bot';
const TIMEOUT_MS = 8000;
const MAX_BODY = 80_000;

// Hub docs: POST /api/bot/webhook (universal) and POST /api/bot/misclick.
const ROUTES = {
  webhook: '/webhook',
  misclick: '/misclick',
  drop: '/webhook',
  sync: '/webhook',
};

function baseUrl() {
  let url = (process.env.AIS_BOT_URL || DEFAULT_BASE).replace(/\/+$/, '');
  if (!/\/api\/bot$/i.test(url)) url = `${url}/api/bot`;
  return url;
}

function secret() {
  return (process.env.BOT_SECRET || '').trim();
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('payload must be a JSON object');
  }
  const raw = JSON.stringify(payload);
  if (raw.length > MAX_BODY) throw new Error('payload too large');
  JSON.parse(raw);
  return raw;
}

async function post(path, payload) {
  if (!secret()) return { skipped: true, reason: 'no BOT_SECRET' };

  let body;
  try {
    body = validatePayload(payload);
  } catch (err) {
    console.warn(`AIS POST ${path}: invalid JSON (${err.message})`);
    return { ok: false, error: err.message };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const url = `${baseUrl()}${path.startsWith('/') ? path : `/${path}`}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Venny-Secret': secret(),
      },
      body,
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      console.warn(`AIS POST ${path}: HTTP ${res.status} ${text.slice(0, 180)}`);
      return { ok: false, status: res.status };
    }
    console.log(`AIS POST ${path}: ok ${res.status}`);
    return { ok: true, status: res.status };
  } catch (err) {
    const why = err.name === 'AbortError' ? `timeout ${TIMEOUT_MS}ms` : err.message;
    console.warn(`AIS POST ${path}: ${why}`);
    return { ok: false, error: why };
  } finally {
    clearTimeout(timer);
  }
}

function emit(event, payload) {
  const path = ROUTES[event] || ROUTES.webhook;
  return post(path, { type: event, ...payload }).catch(err => {
    console.warn(`AIS ${event}: ${err.message}`);
    return { ok: false, error: err.message };
  });
}

function classifyHook(hook = {}, body = {}) {
  const tag = `${hook.name || ''} ${body.source || ''} ${body.type || ''} ${body.kind || ''}`.toLowerCase();
  if (/\bmisclick/.test(tag)) return 'misclick';
  if (/\bdrop\b/.test(tag)) return 'drop';
  if (/\bsync\b/.test(tag)) return 'sync';
  return 'webhook';
}

function ingestIncoming(hook, body) {
  const kind = classifyHook(hook, body);
  return emit(kind, {
    guild_id: hook.guild_id || null,
    source: body.source || hook.name || 'hook',
    title: body.title || hook.name || null,
    content: body.content || body.message || null,
    image_url: body.image_url || body.image || null,
    data: body,
    ts: new Date().toISOString(),
  });
}

module.exports = {
  post,
  emit,
  ingestIncoming,
  classifyHook,
  baseUrl,
  ROUTES,
};
