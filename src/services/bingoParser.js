// Forgiving bingo list parser for clan organizers.
// They paste messy numbered lists from Discord, Google Docs, or a phone.

const MODE_ALIASES = {
  screenshot: ['screenshot', 'ss', 'pic', 'photo', 'manual', 'drop', 'stash', 'emote', 'any', 'proof'],
  wom_activity: ['clue', 'clues', 'count', 'activity', 'scroll'],
  wom_kc: ['kc', 'kills', 'kill', 'boss'],
  wom_xp: ['xp', 'exp', 'skill', 'gains'],
};

const CLUE_TIER = {
  beginner: 'clue_scrolls_beginner',
  easy: 'clue_scrolls_easy',
  medium: 'clue_scrolls_medium',
  hard: 'clue_scrolls_hard',
  elite: 'clue_scrolls_elite',
  master: 'clue_scrolls_master',
};

function resolveMode(raw) {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase().replace(/\s+/g, '_');
  if (MODE_ALIASES[key]) return key;
  for (const [mode, aliases] of Object.entries(MODE_ALIASES)) {
    if (aliases.includes(key) || aliases.includes(raw.trim().toLowerCase())) return mode;
  }
  return null;
}

function inferFromLabel(label) {
  const text = label.toLowerCase();

  // "5 hard clues" / "10 easy clues" / "1 master clue"
  const clueHit = text.match(/(\d+)\s+(beginner|easy|medium|hard|elite|master)\s+clue/);
  if (clueHit) {
    return { verify_mode: 'wom_activity', metric: CLUE_TIER[clueHit[2]], amount: Number(clueHit[1]) };
  }
  if (/\bclues?\s+any\b|\bany\s+tier\b|\bclues?\s+all\b/.test(text)) {
    const n = Number((text.match(/(\d+)/) || [])[1] || 1);
    return { verify_mode: 'wom_activity', metric: 'clue_scrolls_all', amount: n };
  }
  if (/\bmaster clue\b/.test(text) && /\b1\b|\bone\b/.test(text)) {
    return { verify_mode: 'wom_activity', metric: 'clue_scrolls_master', amount: 1 };
  }
  if (/\bbeginner clue\b/.test(text)) {
    return { verify_mode: 'wom_activity', metric: 'clue_scrolls_beginner', amount: 1 };
  }

  // Screenshot-style clue board squares
  if (/(pet|3rd age|third age|ranger boots|wizard boots|holy sandals|uri|stash|screenshot|emote)/.test(text)) {
    return { verify_mode: 'screenshot', metric: null, amount: 0 };
  }

  return { verify_mode: 'screenshot', metric: null, amount: 0 };
}

function stripLine(raw) {
  let line = String(raw || '').replace(/\r/g, '').trim();
  if (!line) return '';
  if (line.startsWith('#') || line.startsWith('//')) return '';
  line = line.replace(/^\s*(?:\d+[\).:\-]\s*|[-*•]\s+)/, '');
  return line.trim();
}

function splitLabelMode(line) {
  const pipe = line.split(/\s*\|\s*/);
  if (pipe.length >= 2) return { label: pipe[0].trim(), modeRaw: pipe.slice(1).join('|').trim() };
  const dash = line.match(/^(.*?)\s+[-–—]\s+([A-Za-z][A-Za-z0-9_ -]{1,20})$/);
  if (dash) return { label: dash[1].trim(), modeRaw: dash[2].trim() };
  return { label: line, modeRaw: null };
}

/**
 * @param {string} text
 * @param {{ defaultMode?: string, maxTiles?: number }} [opts]
 */
function parseBingoList(text, opts = {}) {
  const defaultMode = resolveMode(opts.defaultMode) || 'screenshot';
  const maxTiles = opts.maxTiles || 25;
  const tiles = [];
  const errors = [];
  const lines = String(text || '').split('\n');

  for (let i = 0; i < lines.length; i++) {
    const cleaned = stripLine(lines[i]);
    if (!cleaned) continue;
    if (tiles.length >= maxTiles) {
      errors.push({ line: i + 1, reason: `Board is full (${maxTiles} tiles). Extra line ignored.` });
      continue;
    }
    const { label, modeRaw } = splitLabelMode(cleaned);
    if (!label || label.length > 100) {
      errors.push({ line: i + 1, reason: 'Empty or too long (100 char max).' });
      continue;
    }
    const inferred = inferFromLabel(label);
    const mode = resolveMode(modeRaw) || inferred.verify_mode || defaultMode;
    tiles.push({
      slot: tiles.length,
      label,
      verify_mode: mode,
      metric: inferred.metric,
      amount: inferred.amount || 0,
      notes: null,
      points: 1,
    });
  }

  return { tiles, errors, loaded: tiles.length };
}

module.exports = { parseBingoList, resolveMode, inferFromLabel, MODE_ALIASES };
