const { getDb } = require('../db/database');

const SLOT_LABELS = {
  announce_channel: 'announce-channel',
  reminder_channel: 'reminder-channel',
  audit_channel: 'audit-channel',
};

const ROUTE_ERROR_RE = /Missing Access|Unknown Channel|Missing Permissions/i;

function isMissingDiscordChannel(err) {
  const code = err?.code || err?.status;
  if ([50001, 50013, 10003, 10008, 10004].includes(code)) return true;
  return ROUTE_ERROR_RE.test(err?.message || '');
}

function pickConfiguredSlots(settings = {}, slots = [], { allowFallback = false } = {}) {
  const wanted = Array.from(new Set((Array.isArray(slots) ? slots : []).filter(Boolean)));
  if (!wanted.length) return [];
  if (allowFallback) return wanted.filter(slot => settings?.[slot]);
  const first = wanted.find(slot => settings?.[slot]);
  return first ? [first] : [];
}

async function loadChannelSettings(guildId, slots = Object.keys(SLOT_LABELS), db = getDb()) {
  const wanted = Array.from(new Set((Array.isArray(slots) ? slots : []).filter(Boolean)));
  if (!wanted.length) return {};
  const known = wanted.filter(slot => SLOT_LABELS[slot]);
  if (!known.length) return {};
  const row = await db.prepare(`SELECT ${known.join(', ')} FROM guild_settings WHERE guild_id = ?`).get(guildId);
  return row || {};
}

async function clearConfiguredSlot(guildId, slot, db = getDb()) {
  if (!SLOT_LABELS[slot]) return false;
  await db.prepare(`UPDATE guild_settings SET ${slot} = NULL WHERE guild_id = ?`).run(guildId);
  return true;
}

async function resolveConfiguredChannel(client, guildId, {
  slots = [],
  allowFallback = false,
  db = getDb(),
} = {}) {
  if (!client || !guildId) return null;
  const settings = await loadChannelSettings(guildId, slots, db);
  const candidates = pickConfiguredSlots(settings, slots, { allowFallback });

  for (const slot of candidates) {
    const channelId = settings?.[slot];
    if (!channelId) continue;
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel) return { channel, channelId, slot };
      await clearConfiguredSlot(guildId, slot, db);
    } catch (err) {
      if (isMissingDiscordChannel(err)) {
        await clearConfiguredSlot(guildId, slot, db);
        if (allowFallback) continue;
        return null;
      }
      throw err;
    }
    if (!allowFallback) break;
  }

  return null;
}

async function inspectConfiguredChannels(client, guildId, slots = Object.keys(SLOT_LABELS), db = getDb()) {
  const settings = await loadChannelSettings(guildId, slots, db);
  const reports = [];
  for (const slot of slots) {
    const channelId = settings?.[slot] || null;
    if (!channelId) {
      reports.push({ slot, channelId: null, status: 'unset' });
      continue;
    }
    try {
      const channel = await client.channels.fetch(channelId);
      reports.push({
        slot,
        channelId,
        status: channel ? 'ok' : 'invalid',
        detail: channel ? null : 'Unknown Channel',
      });
    } catch (err) {
      reports.push({
        slot,
        channelId,
        status: isMissingDiscordChannel(err) ? 'invalid' : 'error',
        detail: err?.message || 'Unknown error',
      });
    }
  }
  return reports;
}

module.exports = {
  SLOT_LABELS,
  isMissingDiscordChannel,
  pickConfiguredSlots,
  loadChannelSettings,
  clearConfiguredSlot,
  resolveConfiguredChannel,
  inspectConfiguredChannels,
};
