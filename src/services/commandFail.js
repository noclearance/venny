const { audit } = require('./audit');

function commandLabel(interaction) {
  if (interaction?.commandName) {
    const sub = typeof interaction.options?.getSubcommand === 'function'
      ? interaction.options.getSubcommand(false)
      : null;
    return sub ? `/${interaction.commandName} ${sub}` : `/${interaction.commandName}`;
  }
  if (interaction?.customId) return `button ${String(interaction.customId).slice(0, 80)}`;
  return 'that command';
}

function safeReason(err) {
  let msg = typeof err === 'string' ? err : (err?.message || 'Something went wrong.');
  if (/password|token|secret|DATABASE_URL|api[_-]?key|Bearer /i.test(msg)) {
    msg = 'Something went wrong on my side. I logged it for staff.';
  }
  return String(msg).replace(/\s+/g, ' ').trim().slice(0, 1500) || 'Something went wrong.';
}

async function commandFail(interaction, err, { dm = true } = {}) {
  const why = safeReason(err);
  const cmd = commandLabel(interaction);
  const text = `**${cmd}** did not finish.\n${why}`;

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: text, flags: 64 }).catch(async () => {
        await interaction.editReply({ content: text });
      });
    } else {
      await interaction.reply({ content: text, flags: 64 });
    }
  } catch (replyErr) {
    console.warn(`commandFail reply: ${replyErr.message}`);
  }

  if (interaction.guildId) {
    await audit(
      interaction.client,
      interaction.guildId,
      `\`${cmd}\` failed for <@${interaction.user.id}>: ${why}`,
    );
  }
  console.warn(`Command fail ${cmd} ${interaction.user?.id}: ${why}`);

  if (dm && interaction.user) {
    try {
      await interaction.user.send({
        content: `Venny — **${cmd}** did not run.\n${why}`,
      });
    } catch {
      /* DMs closed */
    }
  }
}

module.exports = { commandFail, safeReason, commandLabel };
