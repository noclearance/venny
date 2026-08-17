// Optional OpenAI copy for public cards.
// Facts stay in code. This only returns { title, description }.
// Missing key, timeout, or junk JSON → the fallback the caller already had.

const TIMEOUT_MS = 2500;
const MODEL = 'gpt-4o-mini';

const SYSTEM = `You write Discord embed copy for Venny, clerk of the Misclickers OSRS clan.

Voice: dry, short, one person. Not epic. Not a brochure. No emojis.
2–4 sentences in description. Title is a short headline (max ~60 chars).

Return JSON only: {"title":"...","description":"..."}

Rules:
- Use only the facts given. Do not invent winners, RSNs, XP, prices, times, or credit amounts.
- Do not mention guild credits, ticket prices, jump links, or exact timestamps. Those are fields on the card.
- Do not list a leaderboard. A one-line reaction to the board is fine; names and numbers stay in code.
- Do not start with "Attention" or "Hear ye".`;

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
      console.warn(`OpenAI ${job}: HTTP ${res.status}`);
      return fallback;
    }

    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw) return fallback;

    const parsed = JSON.parse(raw);
    const title = clip(parsed.title, 256);
    const description = clip(parsed.description, 1800);
    if (!title && !description) return fallback;
    return {
      title: title || fallback.title,
      description: description || fallback.description,
    };
  } catch (err) {
    console.warn(`OpenAI ${job}: ${err.message}`);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { write };
