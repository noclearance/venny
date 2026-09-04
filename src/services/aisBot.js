// Outbound hub ingest. No-op without BOT_SECRET. Never throws into Discord commands.

const DEFAULT_BASE = 'https://misclickerz.ai.studio/api/bot';
const TIMEOUT_MS = 8000;
const MAX_BODY = 80_000;

// Hub docs: POST /api/bot/webhook (universal). Typed `type` is the discriminator.
const ROUTES = {
  webhook: '/webhook',
  misclick: '/webhook',
  drop: '/webhook',
  sync: '/webhook',
};

const TYPES = new Set([
  'sotw_start', 'sotw_end', 'event_start', 'event_remind',
  'raffle_open', 'raffle_win', 'bingo_start', 'botw_start', 'botw_end',
  'rank', 'sync', 'misclick', 'webhook',
]);

function ascii(value) {
  return String(value ?? '')
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ');
}

function factsOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v == null) {
      out[k] = null;
      continue;
    }
    if (typeof v === 'string') out[k] = ascii(v).slice(0, 400);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

function typeOf(raw) {
  const t = String(raw || '').trim();
  return TYPES.has(t) ? t : 'webhook';
}

function pack(payload = {}) {
  const type = typeOf(payload.type);
  return {
    type,
    kind: payload.kind || type,
    guild_id: payload.guild_id || null,
    title: ascii(payload.title || '').slice(0, 200) || null,
    description: ascii(payload.description || payload.content || '').slice(0, 1800) || null,
    jump: payload.jump || null,
    ts: payload.ts || new Date().toISOString(),
    source: payload.source || null,
    facts: factsOf(payload.facts),
  };
}

function typeFromJob(kind, job) {
  if (TYPES.has(job)) return job;
  if (job === 'raffle_start') return 'raffle_open';
  if (job === 'event_soon' || job === 'event_now' || job === 'event_remind') return 'event_remind';
  if (kind === 'sotw' && job === 'sotw_end') return 'sotw_end';
  if (kind === 'sotw') return 'sotw_start';
  if (kind === 'event') return 'event_start';
  if (kind === 'raffle') return job === 'raffle_win' || job === 'raffle_end' ? 'raffle_win' : 'raffle_open';
  if (kind === 'danger' && job === 'botw_end') return 'botw_end';
  if (kind === 'danger') return 'botw_start';
  if (job === 'bingo_start') return 'bingo_start';
  return 'webhook';
}

function baseUrl() {
  let url = (process.env.AIS_BOT_URL || DEFAULT_BASE).replace(/\/+$/, '');
  if (!/\/api\/bot$/i.test(url)) url = `${url}/api/bot`;
  return url;
}

function secret() {
  return (process.env.BOT_SECRET || '').trim();
}

let warnedOff = false;
function warnIfOff() {
  if (secret()) return;
  if (warnedOff) return;
  warnedOff = true;
  console.warn('Hub ingest off — set BOT_SECRET on Render');
}

const SECRET_KEY = /discord_token|bot_token|wom_verif|verification_code|openai|gemini|xai_api|api_token|bot_secret|api_key/i;

function stripSecrets(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stripSecrets);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY.test(k)) continue;
    out[k] = (v && typeof v === 'object') ? stripSecrets(v) : v;
  }
  return out;
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
  if (!secret()) {
    warnIfOff();
    return { skipped: true, reason: 'no BOT_SECRET' };
  }

  let body;
  try {
    body = validatePayload(stripSecrets(payload));
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
  const type = typeOf(event);
  const packed = pack({ type, ...payload });
  return post(ROUTES.webhook, packed).catch(err => {
    console.warn(`AIS ${type}: ${err.message}`);
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
  return emit(kind === 'misclick' ? 'misclick' : 'webhook', {
    guild_id: hook.guild_id || null,
    source: body.source || hook.name || 'hook',
    title: body.title || hook.name || null,
    description: body.content || body.message || null,
    facts: {
      image_url: body.image_url || body.image || null,
    },
    ts: new Date().toISOString(),
  });
}

module.exports = {
  post,
  emit,
  ingestIncoming,
  classifyHook,
  baseUrl,
  warnIfOff,
  ascii,
  pack,
  typeFromJob,
  TYPES,
  ROUTES,
};
