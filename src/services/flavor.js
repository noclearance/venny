// Grazy-style announcement JSON.
// Returns a Discord embed dict: { title, description, color }.
// Callers build the card from that object. Extra facts (credits, jump, prize)
// are fields added in code — same as Grazy's from_dict + extra field.

const TIMEOUT_MS = 12000;
const MODEL = 'gpt-4o-mini';

const PERSONA = `You are Venny, grandmaster of clan events for Misclickers, an Old School RuneScape Discord clan.
Your tone is epic, engaging, slightly cheeky, and highly detailed. You are here to build excitement and rally the members.
Generate a JSON object for a Discord embed with "title", "description", and "color" keys.
color is an integer (0–16777215), not a hex string.
Use vivid language and Discord markdown like **bold** or *italics*. Do not use emojis.
Make every announcement sound like a legendary event is unfolding. Description is a short paragraph, not one line.
Do not invent ticket prices, guild-credit amounts, winners, RSNs, or exact timestamps that were not given.`;

const PROMPTS = {
  sotw_poll: details =>
    `A Skill of the Week poll. Implore the clan to vote. Their choice shapes the week. Skills on the ballot: ${(details.skills || []).join(', ') || 'the council will decide'}. Rolled: ${Boolean(details.rolled)}. Auto-start: ${Boolean(details.autoStart)}.`,
  sotw_start: details =>
    `Skill of the Week has begun for **${details.skill || 'a skill'}** (${details.days || 7} days). A trial of dedication. Glory awaits whoever tops the board.`,
  sotw_end: details =>
    `Skill of the Week for **${details.skill || 'a skill'}** has ended.${details.winner ? ` Champion: **${details.winner}**${details.xp ? ` with ${Number(details.xp).toLocaleString()} XP` : ''}.` : ' Nobody posted gains.'} ${details.placed || 0} on the board.`,
  sotw_standings: details =>
    `Live Skill of the Week standings for **${details.skill || 'a skill'}**. ${details.onBoard || 0} on the board. One short rally line — do not list names.`,
  raffle_start: details =>
    `A clan raffle is open. Grand prize: **${details.prize || details.title || 'a legendary boon'}**. Members pay staff in game, link an RSN, then tap Enter Raffle.`,
  raffle_win: details =>
    `A raffle has been drawn. Title: ${details.title || 'the raffle'}. Prize: ${details.prize || 'the prize'}. ${details.entries || 0} entries. Do not invent the winner's name.`,
  raffle_end: details =>
    `A raffle was closed with no winner. Title: ${details.title || 'the raffle'}.`,
  bingo_start: details =>
    `Clan bingo **${details.title || 'the board'}** is live. A tapestry of trials. Claim tiles on the board or /bingo submit.`,
  event_start: details =>
    `A clan event: **${details.title || 'a gathering'}**. Category: ${details.category || 'general'}.${details.staffNotes ? ` Staff notes: ${details.staffNotes}` : ''} Hit Going on the card.`,
  event_remind: details =>
    `Reminder for **${details.title || 'the event'}**.${details.alreadyReminded ? ' Already reminded once — keep it quiet.' : ' Last call to get logged in.'}`,
  event_soon: details =>
    `**${details.title || 'the event'}** starts in about fifteen minutes. Get to a bank.`,
  event_now: details =>
    `**${details.title || 'the event'}** is live. Get in.`,
  vote_generic: details =>
    `A clan vote. Question: ${details.question || 'a question'}. One vote on the original post.`,
  vote_botw: details =>
    `Boss of the Week vote. Ballot: ${(details.bosses || []).join(', ') || 'the bosses'}. Rolled: ${Boolean(details.rolled)}.`,
  vote_sotw: details =>
    `A Skill of the Week poll. Implore the clan to vote. Skills: ${(details.skills || []).join(', ') || 'the council will decide'}. Rolled: ${Boolean(details.rolled)}. Auto-start: ${Boolean(details.autoStart)}. Week length: ${details.days || 7} days.`,
  leaderboard_hiscores: details =>
    `Clan hiscores for **${details.skill || 'a skill'}**. ${details.count || 0} names. One rally line only — do not list ranks.`,
  leaderboard_gained: details =>
    `XP gained for **${details.skill || 'a skill'}** this ${details.period || 'week'}. One rally line only — do not list ranks.`,
};

const FALLBACKS = {
  sotw_poll: { title: 'A Council of Skills is Convened!', description: 'The council is convened. Which skill shall we master this week? Lend your voice — your vote sets the trial.', color: 15105600 },
  sotw_start: { title: 'The Trial of {skill} Begins!', description: 'The gauntlet is thrown. A Skill of the Week trial of **{skill}** commences now. Dedicate yourselves. The board is live.', color: 5763719 },
  sotw_end: { title: 'The Trial Concludes', description: 'The week is done. The board below is final.', color: 5763719 },
  sotw_standings: { title: 'The Board Stands', description: 'Here is the live Skill of the Week board.', color: 5763719 },
  raffle_start: { title: "Fortune's Favor is Upon Us!", description: 'The gods of chance have opened a raffle. A prize worthy of the clan sits on the table. Pay staff in game, link your RSN, then claim your ticket.', color: 15844367 },
  raffle_win: { title: 'A Champion of Fortune!', description: 'The draw is done. Fate has a name.', color: 15844367 },
  raffle_end: { title: 'The Raffle is Closed', description: 'This raffle ended with no draw. The ticket booth is shut.', color: 10070709 },
  bingo_start: { title: "The Gauntlet is Thrown!", description: 'A new bingo board is live — a tapestry of trials. Claim a tile, or /bingo submit. WOM tiles stamp themselves.', color: 11027200 },
  event_start: { title: 'A Call to Arms!', description: 'A clan event is posted. Hit Going if you are in. I will ping fifteen minutes before.', color: 16711680 },
  event_remind: { title: 'The Hour Approaches', description: 'This is your reminder. Be logged in.', color: 16711680 },
  event_soon: { title: 'Fifteen Minutes', description: 'Last call. Get to a bank and hop.', color: 16711680 },
  event_now: { title: 'It is Time', description: 'The event is up. Get in.', color: 16711680 },
  vote_generic: { title: 'The Clan Must Decide', description: 'A vote is open. One vote. Hit the poll on the original post.', color: 3447003 },
  vote_botw: { title: 'A Hunt is Named', description: 'Vote the Boss of the Week. One vote. The clan picks the prey.', color: 3447003 },
  vote_sotw: { title: 'A Council of Skills is Convened!', description: 'Vote the Skill of the Week. One vote. The winner becomes the trial.', color: 15105600 },
  leaderboard_hiscores: { title: 'Clan Hiscores', description: 'The current board.', color: 3447003 },
  leaderboard_gained: { title: 'Gains This Period', description: 'Who moved.', color: 5763719 },
};

function clip(value, max) {
  const text = String(value || '').replace(/^\n+|\n+$/g, '').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function parseColor(value, fallback) {
  const n = Number(value);
  if (Number.isInteger(n) && n >= 0 && n <= 0xffffff) return n;
  return fallback;
}

function fill(template, details) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, key) => (
    details[key] != null ? String(details[key]) : `{${key}}`
  ));
}

function fallbackOf(job, details = {}, extra = {}) {
  const base = FALLBACKS[job] || { title: 'A New Calling!', description: 'A new event has begun. Answer the call.', color: 3447003 };
  return {
    title: clip(extra.fallbackTitle || fill(base.title, details), 256),
    description: clip(extra.fallbackDescription || fill(base.description, details), 1800),
    color: parseColor(base.color, 3447003),
  };
}

async function announce(job, details = {}, extra = {}) {
  const fallback = fallbackOf(job, details, extra);
  const key = (process.env.OPENAI_API_KEY || '').trim();
  if (!key) {
    console.warn(`OpenAI ${job}: no key — Grazy fallback JSON`);
    return fallback;
  }

  const request = (PROMPTS[job] || (() => `Clan announcement of type ${job}. Details: ${JSON.stringify(details)}`))(details);
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
        temperature: 0.9,
        max_tokens: 450,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: PERSONA },
          { role: 'user', content: `${request}\n\nJSON Output:` },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 429) {
        console.warn('OpenAI quota empty. Add billing at https://platform.openai.com/settings/organization/billing — using Grazy fallback JSON.');
      } else {
        console.warn(`OpenAI ${job}: HTTP ${res.status} ${body.slice(0, 180)}`);
      }
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

    console.log(`OpenAI ${job}: json ${Date.now() - started}ms`);
    return {
      title: title || fallback.title,
      description: description || fallback.description,
      color: parseColor(parsed.color, fallback.color),
    };
  } catch (err) {
    const why = err.name === 'AbortError' ? `timeout ${TIMEOUT_MS}ms` : err.message;
    console.warn(`OpenAI ${job}: fallback (${why})`);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

// Same JSON. Existing callers pass { job, facts, fallbackTitle, fallbackDescription }.
function write({ job, facts = {}, fallbackTitle, fallbackDescription } = {}) {
  return announce(job, facts, { fallbackTitle, fallbackDescription });
}

module.exports = { announce, write };
