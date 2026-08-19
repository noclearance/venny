// Wise Old Man API service
// Docs: https://docs.wiseoldman.net/
// Base URL: https://api.wiseoldman.net/v2

const BASE_URL = 'https://api.wiseoldman.net/v2';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;

function getHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const apiKey = process.env.WOM_API_KEY;
  if (apiKey) headers['x-api-key'] = apiKey;
  return headers;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function womFetch(pathname, options = {}, attempt = 1) {
  const url = `${BASE_URL}${pathname}`;
  const method = (options.method || 'GET').toUpperCase();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...options,
      headers: { ...getHeaders(), ...(options.headers || {}) },
      signal: controller.signal,
    });

    if (res.status === 429 && attempt < MAX_ATTEMPTS) {
      const retryAfterHeader = res.headers.get('retry-after');
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 1500 * attempt;
      await sleep(Number.isFinite(retryAfterMs) ? retryAfterMs : 1500 * attempt);
      return womFetch(pathname, options, attempt + 1);
    }

    if (res.status === 429) {
      throw new Error('WOM API rate limited. Wait a moment and try again.');
    }

    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = body.message || body.error || JSON.stringify(body);
      } catch {
        detail = await res.text().catch(() => '');
      }
      throw new Error(`WOM API ${res.status}: ${detail}`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/plain')) {
      return res.text();
    }
    return res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('WOM API timed out. Try again in a moment.');
    }

    // Retry GET/429 only — never retry POST/PUT/DELETE after a timeout
    // (could create a duplicate WOM competition).
    const canRetry = method === 'GET' && attempt < MAX_ATTEMPTS && err.message && !err.message.startsWith('WOM API');
    if (canRetry) {
      await sleep(400 * attempt);
      return womFetch(pathname, options, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Player Endpoints ──────────────────────────────────

async function searchPlayers(username, limit = 20) {
  const params = new URLSearchParams({ username, limit: String(limit) });
  return womFetch(`/players/search?${params}`);
}

async function getPlayerDetails(username) {
  return womFetch(`/players/${encodeURIComponent(username)}`);
}

async function updatePlayer(username) {
  return womFetch(`/players/${encodeURIComponent(username)}`, { method: 'POST' });
}

async function getPlayerGains(username, period = 'week') {
  const params = new URLSearchParams({ period });
  return womFetch(`/players/${encodeURIComponent(username)}/gained?${params}`);
}

async function getPlayerGainsByDate(username, startDate, endDate) {
  const params = new URLSearchParams({ startDate, endDate });
  return womFetch(`/players/${encodeURIComponent(username)}/gained?${params}`);
}

async function getPlayerAchievements(username) {
  return womFetch(`/players/${encodeURIComponent(username)}/achievements`);
}

async function getPlayerGroups(username) {
  return womFetch(`/players/${encodeURIComponent(username)}/groups`);
}

// ── Group Endpoints ───────────────────────────────────

async function getGroupDetails(groupId) {
  return womFetch(`/groups/${groupId}`);
}

async function getGroupHiscores(groupId, metric, limit = 50) {
  const params = new URLSearchParams({ metric, limit: String(limit) });
  return womFetch(`/groups/${groupId}/hiscores?${params}`);
}

async function getGroupGained(groupId, metric, period = 'week', limit = 50) {
  const params = new URLSearchParams({ metric, period, limit: String(limit) });
  return womFetch(`/groups/${groupId}/gained?${params}`);
}

async function getGroupGainedByDate(groupId, metric, startDate, endDate, limit = 50) {
  const params = new URLSearchParams({ metric, startDate, endDate, limit: String(limit) });
  return womFetch(`/groups/${groupId}/gained?${params}`);
}

async function getGroupCompetitions(groupId, limit = 10) {
  const params = new URLSearchParams({ limit: String(limit) });
  return womFetch(`/groups/${groupId}/competitions?${params}`);
}

// ── Competition Endpoints ─────────────────────────────

async function createCompetition({ title, metric, startsAt, endsAt, groupId, groupVerificationCode, participants }) {
  const safeTitle = String(title || 'SOTW').trim().slice(0, 50);
  const body = { title: safeTitle, metric, startsAt, endsAt };
  if (groupId) {
    body.groupId = groupId;
    body.groupVerificationCode = groupVerificationCode;
  } else if (participants) {
    body.participants = participants;
  }
  return womFetch(`/competitions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function getCompetitionDetails(competitionId) {
  return womFetch(`/competitions/${competitionId}`);
}

async function getCompetitionCsv(competitionId) {
  return womFetch(`/competitions/${competitionId}/csv`);
}

async function editCompetition(competitionId, { verificationCode, ...fields }) {
  const body = { verificationCode, ...fields };
  return womFetch(`/competitions/${competitionId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

async function deleteCompetition(competitionId, verificationCode) {
  return womFetch(`/competitions/${competitionId}`, {
    method: 'DELETE',
    body: JSON.stringify({ verificationCode }),
  });
}

async function addParticipants(competitionId, participants, verificationCode) {
  return womFetch(`/competitions/${competitionId}/participants`, {
    method: 'POST',
    body: JSON.stringify({ participants, verificationCode }),
  });
}

async function updateOutdatedParticipants(competitionId, verificationCode) {
  return womFetch(`/competitions/${competitionId}/update-all`, {
    method: 'POST',
    body: JSON.stringify({ verificationCode }),
  });
}

// ── OSRS Skills List ───────────────────────────────────

const SKILLS = [
  'overall', 'attack', 'defence', 'strength', 'hitpoints', 'ranged',
  'prayer', 'magic', 'cooking', 'woodcutting', 'fletching', 'fishing',
  'firemaking', 'crafting', 'smithing', 'mining', 'herblore', 'agility',
  'thieving', 'slayer', 'farming', 'runecrafting', 'hunter', 'construction',
  'sailing',
];

const SKILL_EMOJIS = {
  overall: '🏆', attack: '⚔️', defence: '🛡️', strength: '💪', hitpoints: '❤️',
  ranged: '🏹', prayer: '🙏', magic: '🪄', cooking: '🍳', woodcutting: '🪓',
  fletching: '🪶', fishing: '🎣', firemaking: '🔥', crafting: '🧵', smithing: '🔨',
  mining: '⛏️', herblore: '🌿', agility: '🏃', thieving: '🥷', slayer: '💀',
  farming: '🌱', runecrafting: '🔮', hunter: '🐾', construction: '🏠', sailing: '⛵',
};

const SKILL_CHOICES = SKILLS.map(skill => ({
  name: skill.charAt(0).toUpperCase() + skill.slice(1),
  value: skill,
}));

function isValidSkill(skill) {
  return SKILLS.includes(skill.toLowerCase());
}

function getSkillEmoji(skill) {
  return SKILL_EMOJIS[skill.toLowerCase()] || '📊';
}

module.exports = {
  // Player
  searchPlayers,
  getPlayerDetails,
  updatePlayer,
  getPlayerGains,
  getPlayerGainsByDate,
  getPlayerAchievements,
  getPlayerGroups,
  // Group
  getGroupDetails,
  getGroupHiscores,
  getGroupGained,
  getGroupGainedByDate,
  getGroupCompetitions,
  // Competition
  createCompetition,
  getCompetitionDetails,
  getCompetitionCsv,
  editCompetition,
  deleteCompetition,
  addParticipants,
  updateOutdatedParticipants,
  // Constants
  SKILLS,
  SKILL_EMOJIS,
  SKILL_CHOICES,
  isValidSkill,
  getSkillEmoji,
};
