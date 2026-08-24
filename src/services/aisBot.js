// Outbound client for the AIS / hub bot API.
// Native fetch (Node 22+). No-op without BOT_SECRET. Never throws into Discord commands.

const DEFAULT_BASE = 'https://ais-dev-a4ljbswi2bmxa7yw7w7wwz-641223815059.us-east1.run.app/api/bot';
const TIMEOUT_MS = 8000;
const MAX_BODY = 80_000;

function baseUrl() {
  return (process.env.AIS_BOT_URL || DEFAULT_BASE).replace(/\/+$/, '');
}

function secret() {
  return (process.env.BOT_SECRET || '').trim();
}

function headers() {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Venny-Secret': secret(),
  };
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
      headers: headers(),
      body,
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      console.warn(`AIS POST ${path}: HTTP ${res.status} ${text.slice(0, 180)}`);
      return { ok: false, status: res.status };
    }
    console.log(`AIS POST ${path}: ok ${res.status}`);
    return { ok: true, status: res.status, body: text.slice(0, 500) };
  } catch (err) {
    const why = err.name === 'AbortError' ? `timeout ${TIMEOUT_MS}ms` : err.message;
    console.warn(`AIS POST ${path}: ${why}`);
    return { ok: false, error: why };
  } finally {
    clearTimeout(timer);
  }
}

function webhook(payload) {
  return post('/webhook', payload);
}

function misclick(payload) {
  return post('/misclick', payload);
}

function drop(payload) {
  return post('/drop', payload);
}

function sync(payload) {
  return post('/sync', payload);
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
  const payload = {
    type: kind,
    guild_id: hook.guild_id || null,
    source: body.source || hook.name || 'hook',
    title: body.title || hook.name || null,
    content: body.content || body.message || null,
    image_url: body.image_url || body.image || null,
    data: body,
    ts: new Date().toISOString(),
  };
  if (kind === 'misclick') return misclick(payload);
  if (kind === 'drop') return drop(payload);
  if (kind === 'sync') return sync(payload);
  return webhook(payload);
}

let streamAbort = null;

async function startEventStream(onEvent) {
  if (!secret()) {
    console.log('AIS hub: off (set BOT_SECRET to push / pull)');
    return null;
  }
  if (streamAbort) return streamAbort;

  streamAbort = new AbortController();
  const url = `${baseUrl()}/events/stream`;
  console.log(`AIS hub: ${baseUrl()}`);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        'X-Venny-Secret': secret(),
      },
      signal: streamAbort.signal,
    });
    const type = String(res.headers.get('content-type') || '');
    if (!res.ok || !type.includes('event-stream')) {
      console.warn(`AIS GET /events/stream: HTTP ${res.status} ${type || 'no content-type'} — hub is not streaming yet`);
      streamAbort.abort();
      streamAbort = null;
      return null;
    }
    console.log('AIS GET /events/stream: connected');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const chunks = buf.split('\n\n');
          buf = chunks.pop() || '';
          for (const chunk of chunks) {
            const dataLine = chunk.split('\n').find(l => l.startsWith('data:'));
            if (!dataLine) continue;
            try {
              const data = JSON.parse(dataLine.slice(5).trim());
              if (typeof onEvent === 'function') onEvent(data);
            } catch (err) {
              console.warn(`AIS stream JSON: ${err.message}`);
            }
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError') console.warn(`AIS stream: ${err.message}`);
      } finally {
        streamAbort = null;
      }
    })();
  } catch (err) {
    if (err.name !== 'AbortError') console.warn(`AIS GET /events/stream: ${err.message}`);
    streamAbort = null;
  }
  return streamAbort;
}

module.exports = {
  post,
  webhook,
  misclick,
  drop,
  sync,
  ingestIncoming,
  classifyHook,
  startEventStream,
  baseUrl,
};
