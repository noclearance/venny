const { PermissionFlagsBits } = require('discord.js');
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
  if (key) return clanRankNames()[key];
  return String(rank || '').trim();
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

function sameColor(role, color) {
  const have = role?.colors?.primaryColor ?? role?.color;
  return Number(have) === Number(color);
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

function stylePatch(role, key, { withIcon }) {
  const style = STYLE[key];
  const base = clanRankNames()[key];
  const wantName = displayName(base, style, withIcon);
  const patch = {};
  if (role.name !== wantName) patch.name = wantName;
  if (!sameColor(role, style.color)) patch.colors = { primaryColor: style.color };
  if (role.hoist !== true) patch.hoist = true;
  if (role.mentionable) patch.mentionable = false;
  if (withIcon) {
    if (!sameEmoji(role.unicodeEmoji, style.emoji)) patch.unicodeEmoji = style.emoji;
  } else if (role.unicodeEmoji) {
    patch.unicodeEmoji = null;
  }
  return patch;
}

async function paintRole(role, key, { withIcon }) {
  const patch = stylePatch(role, key, { withIcon });
  if (!Object.keys(patch).length) return { changed: false, iconFail: false };
  try {
    await role.edit({ ...patch, reason: 'Venny clan rank style' });
    return { changed: true, iconFail: false };
  } catch (err) {
    if (patch.unicodeEmoji === undefined) throw err;
    delete patch.unicodeEmoji;
    if (Object.keys(patch).length) {
      await role.edit({ ...patch, reason: 'Venny clan rank color' });
    }
    return { changed: true, iconFail: true };
  }
}

async function ensure(guild) {
  await guild.roles.fetch();
  const names = clanRankNames();
  const withIcon = canUseRoleIcons(guild);
  const created = [];
  const painted = [];
  const iconFail = [];
  for (const key of ORDER) {
    const name = names[key];
    const style = STYLE[key];
    let role = findNamed(guild, name);
    if (!role) {
      const opts = {
        name: displayName(name, style, withIcon),
        colors: { primaryColor: style.color },
        hoist: true,
        mentionable: false,
        reason: 'Venny clan rank',
      };
      if (withIcon) opts.unicodeEmoji = style.emoji;
      try {
        role = await guild.roles.create(opts);
      } catch (err) {
        if (!withIcon || !opts.unicodeEmoji) throw err;
        delete opts.unicodeEmoji;
        role = await guild.roles.create(opts);
        iconFail.push(name);
      }
      created.push(name);
      continue;
    }
    const out = await paintRole(role, key, { withIcon });
    if (out.changed) painted.push(name);
    if (out.iconFail) iconFail.push(name);
  }
  const report = await inspect(guild);
  return { ...report, created, painted, withIcon, iconFail };
}

function formatReport(report) {
  const lines = report.rows.map(row => {
    const badge = STYLE[row.key]?.emoji ? `${STYLE[row.key].emoji} ` : '';
    if (!row.role) return `${badge}**${row.name}** — missing`;
    const place = row.above ? 'Venny is above it' : 'Venny is below or equal — drag Venny up';
    const emblem = row.role.unicodeEmoji
      ? `emblem ${row.role.unicodeEmoji}`
      : (STYLE[row.key]?.emoji ? `emblem in the name` : 'no emblem');
    return `${badge}**${row.name}** — <@&${row.role.id}> · ${emblem} · ${place}`;
  });
  const created = report.created?.length
    ? `Created: ${report.created.map(n => `**${n}**`).join(', ')}`
    : null;
  const painted = report.painted?.length
    ? `Painted: ${report.painted.map(n => `**${n}**`).join(', ')}`
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
    ? 'Server Settings → Roles → drag **Venny** above the clan ranks.'
    : null;
  return [created, painted, manage, icons, iconFail, `My highest role: **${report.botRoleName}**`, '', ...lines, hint].filter(v => v !== null && v !== undefined).join('\n');
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
