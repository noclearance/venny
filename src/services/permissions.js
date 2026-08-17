const { PermissionFlagsBits } = require('discord.js');

const STAFF_PERMISSION = PermissionFlagsBits.ManageEvents;
const ADMIN_PERMISSION = PermissionFlagsBits.Administrator;

function isModerator(member) {
  if (!member?.permissions) return false;
  const perms = member.permissions;
  return perms.has(PermissionFlagsBits.ManageEvents)
    || perms.has(PermissionFlagsBits.ManageGuild)
    || perms.has(PermissionFlagsBits.Administrator);
}

function isAdmin(member) {
  return Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator));
}

function denyMessage(command, needed) {
  if (needed === 'admin') {
    return 'That’s an admin command. You don’t need it for day-to-day clan stuff.';
  }
  return 'That’s a mod command (Manage Events / Manage Server / Admin).';
}

async function assertCommandAccess(interaction, command) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'Use this in the clan server, not DMs.', flags: 64 });
    return false;
  }

  const sub = interaction.options.getSubcommand(false);
  const needsAdmin = command.adminOnly || (sub && command.adminSubs?.includes(sub));
  const needsStaff = command.staffOnly || (sub && command.staffSubs?.includes(sub));

  if (needsAdmin && !isAdmin(interaction.member)) {
    await ack(interaction, denyMessage(command, 'admin'));
    return false;
  }
  if (needsStaff && !isModerator(interaction.member)) {
    await ack(interaction, denyMessage(command, 'staff'));
    return false;
  }
  return true;
}

async function ack(interaction, content) {
  const payload = { content, flags: 64 };
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({ content }).catch(() => interaction.followUp(payload).catch(() => {}));
  }
  return interaction.reply(payload);
}

module.exports = {
  isModerator,
  isAdmin,
  assertCommandAccess,
  STAFF_PERMISSION,
  ADMIN_PERMISSION,
};
