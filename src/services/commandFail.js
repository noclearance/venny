const { audit } = require('./audit');

const SECRET_RE = /password|token|secret|DATABASE_URL|api[_-]?key|Bearer /i;
const SQL_RE = /\bpostgres(?:ql)?\b|\bsql\b|select\s+distinct|order by|violates .* constraint|duplicate key|syntax error|relation .* does not exist|column .* does not exist|22P02|42P01|42703|23505/i;
const WOM_NETWORK_RE = /\bwise old man\b|\bwom\b|fetch failed|network|socket hang up|timed?\s*out|econnreset|etimedout|enotfound|eai_again|bad gateway|service unavailable|gateway timeout|5\d\d/i;
const DISCORD_PERMISSION_RE = /missing permissions|missing access|unknown interaction|interaction has already been acknowledged|unknown webhook/i;

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

function normalizeMessage(msg) {
  return String(msg || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
}

function scrubSecrets(msg) {
  return SECRET_RE.test(msg)
    ? 'Sensitive error details were redacted.'
    : msg;
}

function technicalReason(err) {
  const base = typeof err === 'string' ? err : (err?.stack || err?.message || 'Something went wrong.');
  const coded = err?.code ? `[code ${err.code}] ${base}` : base;
  return normalizeMessage(scrubSecrets(coded)) || 'Something went wrong.';
}

function classifyFailure(err, detail) {
  const raw = `${err?.name || ''} ${detail}`;

  if (err?.code === 10062 || /unknown interaction/i.test(raw)) return 'discord_interaction';
  if (err?.code === 50013 || err?.code === 50001 || DISCORD_PERMISSION_RE.test(raw)) return 'discord_permission';
  if (WOM_NETWORK_RE.test(raw)) return 'wom_network';
  if (SQL_RE.test(raw)) return 'sql';
  return 'generic';
}

function safeReason(err) {
  const detail = technicalReason(err);
  const kind = classifyFailure(err, detail);
  if (kind === 'sql') return "Couldn't load that from the database - try again in a minute.";
  if (kind === 'wom_network') return "Wise Old Man didn't answer - check the RSN or try later.";
  if (kind === 'discord_permission') return "I don't have permission to do that here.";
  if (kind === 'discord_interaction') return 'That interaction expired before I could finish - try again.';
  return 'Something went wrong on my side. I logged it for staff.';
}

async function commandFail(interaction, err, { dm = true } = {}) {
  const why = safeReason(err);
  const detail = technicalReason(err);
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
      `\`${cmd}\` failed for <@${interaction.user.id}>: ${detail}`,
    );
  }
  console.warn(`Command fail ${cmd} ${interaction.user?.id}: ${detail}`);

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
