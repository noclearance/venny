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
  return ORDER.map(key => ({ name: names[key], value: key }));
}

function resolveKey(rank) {
  const raw = String(rank || '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (HUB_ALIAS[lower]) return HUB_ALIAS[lower];
  if (ORDER.includes(lower)) return lower;
  const names = clanRankNames();
  const hit = ORDER.find(key => names[key].toLowerCase() === lower);
  return hit || '';
}

function discordNameForRank(rank) {
  const key = resolveKey(rank);
  if (key) return clanRankNames()[key];
  return String(rank || '').trim();
}

function findNamed(guild, name) {
  const want = String(name || '').toLowerCase();
  return guild.roles.cache.find(r => r.name.toLowerCase() === want) || null;
}

function clanRankRoleIds(guild) {
  const names = new Set(Object.values(clanRankNames()).map(n => n.toLowerCase()));
  return guild.roles.cache.filter(r => names.has(r.name.toLowerCase()));
}

function currentKey(member) {
  const names = clanRankNames();
  let best = -1;
  let key = '';
  for (const [k, name] of Object.entries(names)) {
    const role = member.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase());
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

async function ensure(guild) {
  await guild.roles.fetch();
  const names = clanRankNames();
  const created = [];
  for (const key of ORDER) {
    const name = names[key];
    if (findNamed(guild, name)) continue;
    await guild.roles.create({
      name,
      mentionable: false,
      reason: 'Venny clan rank',
    });
    created.push(name);
  }
  const report = await inspect(guild);
  return { ...report, created };
}

function formatReport(report) {
  const lines = report.rows.map(row => {
    if (!row.role) return `**${row.name}** — missing`;
    const place = row.above ? 'Venny is above it' : 'Venny is below or equal — drag Venny up';
    return `**${row.name}** — <@&${row.role.id}> · ${place}`;
  });
  const created = report.created?.length
    ? `Created: ${report.created.map(n => `**${n}**`).join(', ')}`
    : null;
  const manage = report.canManage
    ? 'Manage Roles: yes'
    : 'Manage Roles: **no** — I cannot put ranks on people until this is on.';
  const stuck = report.rows.some(row => row.role && row.above === false);
  const hint = stuck
    ? 'Server Settings → Roles → drag **Venny** above the clan ranks.'
    : null;
  return [created, manage, `My highest role: **${report.botRoleName}**`, '', ...lines, hint].filter(v => v !== null).join('\n');
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
  clanRankNames,
  rankChoices,
  resolveKey,
  discordNameForRank,
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
