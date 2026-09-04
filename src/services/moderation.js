const { PermissionFlagsBits } = require('discord.js');

const ACTION_PERM = {
  timeout: PermissionFlagsBits.ModerateMembers,
  untimeout: PermissionFlagsBits.ModerateMembers,
  kick: PermissionFlagsBits.KickMembers,
  ban: PermissionFlagsBits.BanMembers,
  unban: PermissionFlagsBits.BanMembers,
  purge: PermissionFlagsBits.ManageMessages,
};

const SEE_MOD = 0n;

function canSeeMod(member) {
  if (!member?.permissions) return false;
  return Object.values(ACTION_PERM).some(bit => member.permissions.has(bit));
}

const DURATIONS = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '28d': 28 * 24 * 60 * 60 * 1000,
};



function clipReason(value) {
  return String(value || '').trim().slice(0, 400);
}

function snowflake(value) {
  const id = String(value || '').trim();
  if (!/^\d{5,32}$/.test(id)) return '';
  return id;
}

function assertHasPerm(actor, action) {
  const need = ACTION_PERM[action];
  if (!need) throw new Error('Unknown mod action.');
  if (!actor?.permissions?.has(need)) {
    const names = {
      timeout: 'Timeout Members',
      untimeout: 'Timeout Members',
      kick: 'Kick Members',
      ban: 'Ban Members',
      unban: 'Ban Members',
      purge: 'Manage Messages',
    };
    throw new Error(`You need **${names[action]}** for that. Manage Events is only for masses / SOTW.`);
  }
}

function assertCanAct(actor, target, me) {
  if (!target) throw new Error('They are not in this server.');
  if (target.id === actor.id) throw new Error('You cannot do that to yourself.');
  if (me && target.id === me.id) throw new Error('I will not kick or mute myself.');
  const ownerId = actor.guild?.ownerId;
  if (ownerId && target.id === ownerId) throw new Error('That is the server owner.');
  const actorPos = actor.roles?.highest?.position ?? 0;
  const targetPos = target.roles?.highest?.position ?? 0;
  const botPos = me?.roles?.highest?.position ?? 0;
  if (ownerId !== actor.id && targetPos >= actorPos) {
    throw new Error('Their role sits at or above yours.');
  }
  if (targetPos >= botPos) {
    throw new Error('Venny’s role is not above theirs. Server Settings → Roles → drag Venny up.');
  }
}

function discordWhy(err) {
  const code = err?.code;
  if (code === 50013 || /Missing Permissions/i.test(err?.message || '')) {
    return 'Discord said missing permissions. Check Venny’s Kick / Ban / Timeout / Manage Messages, and that Venny sits above the target.';
  }
  if (code === 50035 || /Invalid Form Body/i.test(err?.message || '')) {
    return 'Discord rejected that user id.';
  }
  return err?.message || 'Discord refused.';
}

async function tell(user, text) {
  if (!user || user.bot) return;
  try {
    await user.send(text);
  } catch {
    // DMs closed
  }
}

module.exports = {
  ACTION_PERM,
  SEE_MOD,
  DURATIONS,
  canSeeMod,
  clipReason,
  snowflake,
  assertHasPerm,
  assertCanAct,
  discordWhy,
  tell,
};
