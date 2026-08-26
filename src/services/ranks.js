const { PermissionFlagsBits } = require('discord.js');

function clanRankNames() {
  return {
    trial: process.env.ROLE_TRIAL || 'Trial',
    member: process.env.ROLE_MEMBER || 'Member',
    veteran: process.env.ROLE_VETERAN || 'Veteran',
    officer: process.env.ROLE_OFFICER || 'Officer',
    admin: process.env.ROLE_ADMIN || 'Admin',
  };
}

const ORDER = ['trial', 'member', 'veteran', 'officer', 'admin'];

function findNamed(guild, name) {
  const want = String(name || '').toLowerCase();
  return guild.roles.cache.find(r => r.name.toLowerCase() === want) || null;
}

async function inspect(guild) {
  await guild.roles.fetch();
  const me = guild.members.me;
  const botRole = me?.roles?.highest;
  const botPos = botRole?.position ?? 0;
  const canManage = Boolean(me?.permissions?.has(PermissionFlagsBits.ManageRoles));
  const rows = ORDER.map(key => {
    const name = clanRankNames()[key];
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
    ? 'Server Settings → Roles → drag **Venny** above Trial / Member / Veteran / Officer / Admin.'
    : null;
  return [created, manage, `My highest role: **${report.botRoleName}**`, '', ...lines, hint].filter(v => v !== null).join('\n');
}

module.exports = { clanRankNames, ORDER, inspect, ensure, formatReport, findNamed };
