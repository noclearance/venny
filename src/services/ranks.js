const { PermissionFlagsBits } = require('discord.js');
const { Routes } = require('discord-api-types/v10');
const { getDb } = require('../db/database');

const ORDER = [
  'woodling',
  'prospector',
  'alchemist',
  'ranger',
  'slayer',
  'guardian',
  'dragonbane',
  'warmaster',
  'demigod',
  'ascendant',
];

const STAFF_KEYS = new Set(['warmaster', 'demigod', 'ascendant']);

const HUB_ALIAS = {
  trial: 'woodling',
  member: 'prospector',
  veteran: 'dragonbane',
  officer: 'warmaster',
  admin: 'ascendant',
};

const DEFAULT_NAMES = {
  woodling: 'Woodling',
  prospector: 'Prospector',
  alchemist: 'Alchemist',
  ranger: 'Ranger',
  slayer: 'Slayer',
  guardian: 'Guardian',
  dragonbane: 'Dragonbane',
  warmaster: 'Warmaster',
  demigod: 'Demigod',
  ascendant: 'Ascendant',
};

const STYLE = {
  woodling: { color: 0xB8894A, emoji: '🪵' },
  prospector: { color: 0xD4923A, emoji: '⛏️' },
  alchemist: { color: 0x3DB36A, emoji: '🧪' },
  ranger: { color: 0x2E9E57, emoji: '🏹' },
  slayer: { color: 0xC23B4A, emoji: '💀' },
  guardian: { color: 0x4A7FD4, emoji: '🛡️' },
  dragonbane: { color: 0xE03A2F, emoji: '🐉' },
  warmaster: { color: 0xA83248, emoji: '⚔️' },
  demigod: { color: 0x8E54C9, emoji: '✨' },
  ascendant: { color: 0xE8C547, emoji: '👑' },
};

const ENV_KEY = {
  woodling: 'ROLE_WOODLING',
  prospector: 'ROLE_PROSPECTOR',
  alchemist: 'ROLE_ALCHEMIST',
  ranger: 'ROLE_RANGER',
  slayer: 'ROLE_SLAYER',
  guardian: 'ROLE_GUARDIAN',
  dragonbane: 'ROLE_DRAGONBANE',
  warmaster: 'ROLE_WARMASTER',
  demigod: 'ROLE_DEMIGOD',
  ascendant: 'ROLE_ASCENDANT',
};

const LEGACY_ENV = {
  woodling: 'ROLE_TRIAL',
  prospector: 'ROLE_MEMBER',
  dragonbane: 'ROLE_VETERAN',
  warmaster: 'ROLE_OFFICER',
  ascendant: 'ROLE_ADMIN',
};

function clanRankNames() {
  const out = {};
  for (const key of ORDER) {
    out[key] = process.env[ENV_KEY[key]]
      || (LEGACY_ENV[key] && process.env[LEGACY_ENV[key]])
      || DEFAULT_NAMES[key];
  }
  return out;
}

function rankChoices() {
  const names = clanRankNames();
  return ORDER.map(key => {
    const emoji = STYLE[key]?.emoji;
    const name = names[key];
    return { name: emoji ? `${emoji} ${name}` : name, value: key };
  });
}

function resolveKey(rank) {
  const raw = String(rank || '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (HUB_ALIAS[lower]) return HUB_ALIAS[lower];
  if (ORDER.includes(lower)) return lower;
  const names = clanRankNames();
  const hit = ORDER.find(key => nameMatches(lower, names[key]) || names[key].toLowerCase() === lower);
  return hit || '';
}

function discordNameForRank(rank) {
  const key = resolveKey(rank);
  return key ? clanRankNames()[key] : '';
}

function nameMatches(roleName, want) {
  const have = String(roleName || '').trim().toLowerCase();
  const base = String(want || '').trim().toLowerCase();
  if (!have || !base) return false;
  return have === base || have.endsWith(` ${base}`);
}

function labelFor(key) {
  const name = clanRankNames()[key];
  if (!name) return '';
  const emoji = STYLE[key]?.emoji;
  return emoji ? `${emoji} **${name}**` : `**${name}**`;
}

function canUseRoleIcons(guild) {
  const feats = guild?.features;
  if (!feats) return false;
  if (typeof feats.has === 'function') return feats.has('ROLE_ICONS');
  if (Array.isArray(feats)) return feats.includes('ROLE_ICONS');
  return false;
}

function displayName(base, style, withIcon) {
  if (withIcon) return base;
  const emoji = style?.emoji;
  if (!emoji) return base;
  if (String(base).startsWith(emoji)) return base;
  return `${emoji} ${base}`;
}

function colorOf(role) {
  const n = role?.colors?.primaryColor ?? role?.color;
  return Number.isFinite(Number(n)) ? Number(n) : 0;
}

function sameColor(role, color) {
  return colorOf(role) === Number(color);
}

function hexOf(color) {
  return `#${Number(color || 0).toString(16).padStart(6, '0').toUpperCase()}`;
}

function sameEmoji(have, want) {
  const a = String(have || '').replace(/\uFE0F/g, '');
  const b = String(want || '').replace(/\uFE0F/g, '');
  return a === b;
}

function findNamed(guild, name) {
  return guild.roles.cache.find(r => nameMatches(r.name, name)) || null;
}

function clanRankRoleIds(guild) {
  const names = Object.values(clanRankNames());
  return guild.roles.cache.filter(r => names.some(n => nameMatches(r.name, n)));
}

function currentKey(member) {
  const names = clanRankNames();
  let best = -1;
  let key = '';
  for (const [k, name] of Object.entries(names)) {
    const role = member.roles.cache.find(r => nameMatches(r.name, name));
    if (!role) continue;
    const idx = ORDER.indexOf(k);
    if (idx > best) {
      best = idx;
      key = k;
    }
  }
  return key;
}

async function inspect(guild) {
  await guild.roles.fetch();
  const me = guild.members.me;
  const botRole = me?.roles?.highest;
  const botPos = botRole?.position ?? 0;
  const canManage = Boolean(me?.permissions?.has(PermissionFlagsBits.ManageRoles));
  const names = clanRankNames();
  const rows = ORDER.map(key => {
    const name = names[key];
    const role = findNamed(guild, name);
    return {
      key,
      name,
      role,
      above: role ? botPos > role.position : null,
    };
  });
  return {
    canManage,
    botPos,
    botRoleName: botRole?.name || '—',
    rows,
  };
}

function styleBody(role, key, { withIcon }) {
  const style = STYLE[key];
  const base = clanRankNames()[key];
  const wantName = displayName(base, style, withIcon);
  const body = {
    color: style.color,
    colors: {
      primary_color: style.color,
      secondary_color: null,
      tertiary_color: null,
    },
    hoist: true,
    mentionable: false,
  };
  if (role.name !== wantName) body.name = wantName;
  if (withIcon) body.unicode_emoji = style.emoji;
  else if (role.unicodeEmoji) body.unicode_emoji = null;
  return { body, wantName, style };
}

function alreadyStyled(role, key, { withIcon }) {
  const style = STYLE[key];
  const wantName = displayName(clanRankNames()[key], style, withIcon);
  if (!sameColor(role, style.color)) return false;
  if (role.hoist !== true) return false;
  if (role.mentionable) return false;
  if (role.name !== wantName) return false;
  if (withIcon) return sameEmoji(role.unicodeEmoji, style.emoji);
  return !role.unicodeEmoji;
}

async function paintRole(role, key, { withIcon, force = false }) {
  const guild = role.guild;
  const me = guild.members.me;
  if (!me?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
    return { changed: false, error: 'Venny needs Manage Roles' };
  }
  if (me.roles.highest.comparePositionTo(role) <= 0) {
    return { changed: false, error: 'above Venny — I cannot set its Discord color' };
  }
  if (!force && alreadyStyled(role, key, { withIcon })) {
    return { changed: false };
  }

  const { body } = styleBody(role, key, { withIcon });
  const patch = async (payload) => {
    await guild.client.rest.patch(Routes.guildRole(guild.id, role.id), {
      body: payload,
      reason: 'Venny clan rank color',
    });
  };

  try {
    await patch(body);
    return { changed: true };
  } catch (err) {
    if (body.unicode_emoji === undefined) {
      return { changed: false, error: err.message };
    }
    const fallback = { ...body };
    delete fallback.unicode_emoji;
    try {
      await patch(fallback);
      return { changed: true, iconFail: true };
    } catch (err2) {
      return { changed: false, error: err2.message };
    }
  }
}

function assignStackPositions(current) {
  return [...current].sort((a, b) => a - b);
}

function slotOf(role) {
  return Number(role.rawPosition ?? role.position ?? 0);
}

function alreadyStacked(roles) {
  for (let i = 1; i < roles.length; i++) {
    if (slotOf(roles[i]) <= slotOf(roles[i - 1])) return false;
  }
  return roles.length > 0;
}

async function orderLadder(guild) {
  const me = guild.members.me;
  if (!me?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
    return { ordered: false, reason: 'no Manage Roles' };
  }
  const highest = me.roles.highest;
  const names = clanRankNames();
  const roles = ORDER.map(key => findNamed(guild, names[key])).filter(Boolean);
  const movable = roles.filter(r => highest && highest.comparePositionTo(r) > 0);
  const stuck = roles.filter(r => !highest || highest.comparePositionTo(r) <= 0).map(r => r.name);
  if (movable.length < 2) {
    return {
      ordered: false,
      already: movable.length === 1,
      reason: stuck.length ? 'ranks sit above Venny' : (movable.length ? 'only one rank' : 'no ranks'),
      stuck,
    };
  }
  if (alreadyStacked(movable)) {
    return { ordered: false, already: true, stuck };
  }
  const slots = assignStackPositions(movable.map(slotOf));
  const payload = movable.map((role, i) => ({ role: role.id, position: slots[i] }));
  try {
    await guild.roles.setPositions(payload);
    return { ordered: true, stuck };
  } catch (err) {
    console.warn(`rank order: ${err.message}`);
    return { ordered: false, reason: err.message, stuck };
  }
}

async function createRank(guild, key, withIcon) {
  const name = clanRankNames()[key];
  const style = STYLE[key];
  const opts = {
    name: displayName(name, style, withIcon),
    color: style.color,
    hoist: true,
    mentionable: false,
    reason: 'Venny clan rank',
  };
  if (withIcon) opts.unicodeEmoji = style.emoji;
  try {
    return { role: await guild.roles.create(opts), iconFail: false };
  } catch (err) {
    if (!opts.unicodeEmoji) return { error: err.message };
    delete opts.unicodeEmoji;
    try {
      return { role: await guild.roles.create(opts), iconFail: true };
    } catch (err2) {
      return { error: err2.message };
    }
  }
}

async function paintExisting(guild) {
  await guild.roles.fetch();
  const names = clanRankNames();
  const withIcon = canUseRoleIcons(guild);
  const painted = [];
  const failed = [];
  const iconFail = [];
  for (const key of ORDER) {
    const name = names[key];
    const role = findNamed(guild, name);
    if (!role) continue;
    const out = await paintRole(role, key, { withIcon, force: false });
    if (out.changed) painted.push(name);
    if (out.iconFail) iconFail.push(name);
    if (out.error) failed.push(`${name}: ${out.error}`);
  }
  const stack = await orderLadder(guild);
  if (painted.length) console.log(`rank color ${guild.name}: ${painted.join(', ')}`);
  if (stack.ordered) console.log(`rank order ${guild.name}: Woodling bottom → Ascendant top`);
  if (failed.length) console.warn(`rank color ${guild.name}: ${failed.join('; ')}`);
  if (stack.reason && !stack.already) console.warn(`rank order ${guild.name}: ${stack.reason}`);
  return { painted, failed, iconFail, withIcon, stack };
}

async function ensure(guild) {
  await guild.roles.fetch();
  const names = clanRankNames();
  const withIcon = canUseRoleIcons(guild);
  const created = [];
  const painted = [];
  const iconFail = [];
  const failed = [];
  // Highest first so a fresh create does not leave Woodling on top.
  for (const key of [...ORDER].reverse()) {
    const name = names[key];
    if (findNamed(guild, name)) continue;
    const made = await createRank(guild, key, withIcon);
    if (made.error) {
      failed.push(`${name}: ${made.error}`);
      continue;
    }
    if (made.iconFail) iconFail.push(name);
    created.push(name);
  }
  for (const key of ORDER) {
    const name = names[key];
    const role = findNamed(guild, name);
    if (!role) continue;
    const out = await paintRole(role, key, { withIcon, force: true });
    if (out.changed) painted.push(name);
    if (out.iconFail) iconFail.push(name);
    if (out.error) failed.push(`${name}: ${out.error}`);
  }
  const stack = await orderLadder(guild);
  const report = await inspect(guild);
  return { ...report, created, painted, withIcon, iconFail, failed, stack };
}

function formatReport(report) {
  const lines = report.rows.map(row => {
    const badge = STYLE[row.key]?.emoji ? `${STYLE[row.key].emoji} ` : '';
    if (!row.role) return `${badge}**${row.name}** — missing`;
    const have = hexOf(colorOf(row.role));
    const want = hexOf(STYLE[row.key].color);
    const colorBit = have === want ? `Discord color ${have}` : `Discord color ${have} (want ${want})`;
    const place = row.above ? 'Venny is above it' : 'Venny is below it — cannot paint until you drag Venny up';
    const emblem = row.role.unicodeEmoji
      ? `emblem ${row.role.unicodeEmoji}`
      : (STYLE[row.key]?.emoji ? `emblem in the name` : 'no emblem');
    return `${badge}**${row.name}** — <@&${row.role.id}> · ${colorBit} · ${emblem} · ${place}`;
  });
  const created = report.created?.length
    ? `Created: ${report.created.map(n => `**${n}**`).join(', ')}`
    : null;
  const painted = report.painted?.length
    ? `Wrote Discord role color on: ${report.painted.map(n => `**${n}**`).join(', ')}`
    : null;
  const failed = report.failed?.length
    ? `Could not color: ${report.failed.join('; ')}`
    : null;
  const manage = report.canManage
    ? 'Manage Roles: yes'
    : 'Manage Roles: **no** — I cannot put ranks on people until this is on.';
  const icons = report.withIcon
    ? 'Emblems: role icons (this server can use them).'
    : 'Emblems: on the role name. Level 2 boost unlocks proper role icons next to names.';
  const iconFail = report.iconFail?.length
    ? `Could not set role icons on ${report.iconFail.map(n => `**${n}**`).join(', ')} — colors still applied.`
    : null;
  const stuck = report.rows.some(row => row.role && row.above === false);
  const hint = stuck
    ? 'Server Settings → Roles → drag **Venny** above the clan ranks, then run this again. I cannot change a role’s color or order if that role sits above me.'
    : null;
  const orderLine = report.stack?.ordered
    ? 'Restacked Server Settings → Roles: **Woodling** at the bottom, **Ascendant** at the top.'
    : report.stack?.already
      ? 'Role order: Woodling (bottom) → Ascendant (top).'
      : null;
  const orderFail = report.stack?.reason && !report.stack.already
    ? `Could not restack: ${report.stack.reason}`
    : null;
  const stuckAbove = report.stack?.stuck?.length
    ? `Still above me so I could not move: ${report.stack.stuck.map(n => `**${n}**`).join(', ')}`
    : null;
  return [
    'This writes the color onto the Discord role itself (Server Settings → Roles), not just this message.',
    created,
    painted,
    failed,
    orderLine,
    orderFail,
    stuckAbove,
    manage,
    icons,
    iconFail,
    `My highest role: **${report.botRoleName}**`,
    '',
    ...lines,
    hint,
  ].filter(v => v !== null && v !== undefined).join('\n');
}

async function applyRank(client, guildId, userId, rank, { reason, exclusive = true, extraStrip } = {}) {
  if (!client?.isReady?.()) throw new Error('discord offline');
  const guild = await client.guilds.fetch(guildId);
  await guild.roles.fetch();
  const me = guild.members.me;
  if (!me?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error('Venny needs Manage Roles. Run `/config ranks` and drag Venny above the clan ranks.');
  }
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throw new Error('that Discord user is not in this server');

  const name = discordNameForRank(rank);
  if (!name) throw new Error('rank required');
  const role = findNamed(guild, name);
  if (!role) throw new Error(`no Discord role named "${name}" — run \`/config ranks\``);
  if (me.roles.highest.comparePositionTo(role) <= 0) {
    throw new Error(`Venny’s role is not above **${role.name}**. Drag Venny up. \`/config ranks\` shows the list.`);
  }

  const why = String(reason || `Rank ${role.name}`).slice(0, 200);
  const removed = [];
  if (exclusive) {
    const extra = extraStrip instanceof Set ? extraStrip : new Set();
    const gone = member.roles.cache.filter(r => (
      r.id !== role.id && (clanRankRoleIds(guild).has(r.id) || extra.has(r.id))
    ));
    if (gone.size) {
      await member.roles.remove(gone, why);
      for (const r of gone.values()) removed.push({ id: r.id, name: r.name });
    }
  }
  if (!member.roles.cache.has(role.id)) {
    await member.roles.add(role, why);
  }
  await require('./audit').audit(client, guildId, `**${role.name}** on <@${userId}> (${why})`);
  return {
    ok: true,
    discord_id: userId,
    rank: role.name,
    role_id: role.id,
    added: true,
    removed,
  };
}

async function clearRanks(client, guildId, userId, { reason } = {}) {
  const guild = await client.guilds.fetch(guildId);
  await guild.roles.fetch();
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throw new Error('that Discord user is not in this server');
  const gone = member.roles.cache.filter(r => clanRankRoleIds(guild).has(r.id));
  if (gone.size) await member.roles.remove(gone, String(reason || 'Rank clear').slice(0, 200));
  await require('./audit').audit(client, guildId, `Clan ranks cleared on <@${userId}>`);
  return { ok: true, removed: [...gone.values()].map(r => r.name) };
}

function targetFromActivity({ linked, goings, wins }) {
  let idx = -1;
  if (!linked && goings >= 1) idx = Math.max(idx, ORDER.indexOf('woodling'));
  if (linked) idx = Math.max(idx, ORDER.indexOf('prospector'));
  if (goings >= 3) idx = Math.max(idx, ORDER.indexOf('alchemist'));
  if (goings >= 8) idx = Math.max(idx, ORDER.indexOf('ranger'));
  if (goings >= 15) idx = Math.max(idx, ORDER.indexOf('slayer'));
  if (goings >= 30) idx = Math.max(idx, ORDER.indexOf('guardian'));
  if (wins >= 1 && idx >= ORDER.indexOf('ranger')) {
    idx = Math.max(idx, ORDER.indexOf('dragonbane'));
  }
  if (idx < 0) return '';
  const key = ORDER[idx];
  if (STAFF_KEYS.has(key)) return 'dragonbane';
  return key;
}

async function activityCounts(guildId, userId) {
  const db = getDb();
  const linked = await db.prepare(
    'SELECT rsn FROM members WHERE guild_id = ? AND user_id = ?',
  ).get(guildId, userId);
  const going = await db.prepare(`
    SELECT COUNT(*) as count
    FROM event_attendance ea
    JOIN events e ON e.id = ea.event_id
    WHERE e.guild_id = ? AND ea.user_id = ? AND ea.status = ?
  `).get(guildId, userId, 'yes');
  const sotw = linked?.rsn
    ? await db.prepare(
      'SELECT COUNT(*) as count FROM sotw_winners WHERE guild_id = ? AND lower(winner_rsn) = lower(?)',
    ).get(guildId, linked.rsn)
    : { count: 0 };
  const botw = await db.prepare(
    'SELECT COUNT(*) as count FROM economy_ledger WHERE guild_id = ? AND user_id = ? AND reason = ?',
  ).get(guildId, userId, 'botw_win');
  return {
    linked: Boolean(linked),
    goings: Number(going?.count || 0),
    wins: Number(sotw?.count || 0) + Number(botw?.count || 0),
  };
}

async function maybePromote(client, guildId, userId) {
  if (!client || !guildId || !userId) return null;
  try {
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return null;
    const have = currentKey(member);
    if (have && STAFF_KEYS.has(have)) return null;
    const stats = await activityCounts(guildId, userId);
    const want = targetFromActivity(stats);
    if (!want) return null;
    const haveIdx = have ? ORDER.indexOf(have) : -1;
    const wantIdx = ORDER.indexOf(want);
    if (wantIdx <= haveIdx) return null;
    if (STAFF_KEYS.has(want)) return null;
    return await applyRank(client, guildId, userId, want, { reason: 'auto' });
  } catch (err) {
    console.warn(`rank auto: ${err.message}`);
    return null;
  }
}

module.exports = {
  ORDER,
  STAFF_KEYS,
  HUB_ALIAS,
  STYLE,
  clanRankNames,
  rankChoices,
  resolveKey,
  discordNameForRank,
  nameMatches,
  labelFor,
  canUseRoleIcons,
  displayName,
  hexOf,
  assignStackPositions,
  paintExisting,
  findNamed,
  clanRankRoleIds,
  currentKey,
  inspect,
  ensure,
  formatReport,
  applyRank,
  clearRanks,
  targetFromActivity,
  maybePromote,
};
