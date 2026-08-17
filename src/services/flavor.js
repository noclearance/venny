// Optional OpenAI copy for public cards.
// Facts stay in code. This only returns { title, description }.
// Missing key, timeout, or junk JSON → the fallback the caller already had.

// Slash commands are already deferred, so a few seconds is fine.
// 2.5s was aborting on Render and silently using the staff text.
const TIMEOUT_MS = 12000;
const MODEL = 'gpt-4o-mini';

const SYSTEM = `You write Discord embed copy for Venny, the Misclickers OSRS clan bot.

Sound like a clan mate who wants people to show up. Warm, sharp, a little cheeky.
Not a government form. Not a movie trailer. 1–3 emojis are fine.

Return JSON only: {"title":"...","description":"..."}

title: short, specific to THIS post. Punch up the staff title — do not paste it back unchanged.
description: 2–4 sentences that sell the prize / skill / event using the staff notes.

Do not invent winners, RSNs, XP, ticket prices, credit amounts, or times.
Do not mention guild credits, GP prices, or timestamps — those are fields on the card.
Do not list a leaderboard. Do not start with "Attention" or "Hear ye".`;

function clip(value, max) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function fallbackOf(fallbackTitle, fallbackDescription) {
  return {
    title: clip(fallbackTitle, 256),
    description: clip(fallbackDescription, 1800),
  };
}

async function write({ job, facts = {}, fallbackTitle, fallbackDescription } = {}) {
  const fallback = fallbackOf(fallbackTitle, fallbackDescription);
  const key = (process.env.OPENAI_API_KEY || '').trim();
  if (!key) return fallback;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.85,
        max_tokens: 220,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: `Job: ${job}\nFacts: ${JSON.stringify(facts)}\nReturn JSON.`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`OpenAI ${job}: HTTP ${res.status} ${body.slice(0, 180)}`);
      return fallback;
    }

    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw) {
      console.warn(`OpenAI ${job}: empty response`);
      return fallback;
    }

    const parsed = JSON.parse(raw);
    const title = clip(parsed.title, 256);
    const description = clip(parsed.description, 1800);
    if (!title && !description) {
      console.warn(`OpenAI ${job}: JSON missing title/description`);
      return fallback;
    }
    console.log(`OpenAI ${job}: ok ${Date.now() - started}ms`);
    return {
      title: title || fallback.title,
      description: description || fallback.description,
    };
  } catch (err) {
    const why = err.name === 'AbortError' ? `timeout ${TIMEOUT_MS}ms` : err.message;
    console.warn(`OpenAI ${job}: fallback (${why})`);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { write };
