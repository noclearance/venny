const { getDb } = require('../db/database');
const { handleRsvp } = require('../services/rsvp');
const { parseConfirmationId } = require('../services/confirmations');
const { audit } = require('../services/audit');

async function handleButton(interaction) {
  const db = getDb();

  if (interaction.customId.startsWith('raffle_enter_')) {
    return handleRaffleEnter(interaction, db);
  }

  if (interaction.customId.startsWith('rsvp:')) {
    return handleRsvp(interaction);
  }

  if (interaction.customId.startsWith('page:') && !interaction.customId.startsWith('page_info:')) {
    return handlePagination(interaction);
  }

  if (interaction.customId.startsWith('confirm:') || interaction.customId.startsWith('cancel:')) {
    return handleConfirmation(interaction, db);
  }

  if (interaction.customId.startsWith('bingo_ok:') || interaction.customId.startsWith('bingo_no:')) {
    return handleBingoReview(interaction, db);
  }
}

async function handleRaffleEnter(interaction, db) {
  const raffleId = parseInt(interaction.customId.replace('raffle_enter_', ''), 10);

  const raffle = await db.prepare('SELECT * FROM raffles WHERE id = ? AND drawn = 0').get(raffleId);
  if (!raffle) {
    return interaction.reply({ content: 'This raffle is no longer active.', flags: 64 });
  }

  const member = await db.prepare('SELECT * FROM members WHERE guild_id = ? AND user_id = ?').get(interaction.guildId, interaction.user.id);
  if (!member) {
    return interaction.reply({ content: '❌ You need to link your OSRS RSN first! Use `/member link rsn:<your_name>` to get started.', flags: 64 });
  }

  try {
    await db.prepare('INSERT INTO raffle_entries (raffle_id, user_id) VALUES (?, ?)').run(raffleId, interaction.user.id);
    await require('../services/economy').award(interaction.guildId, interaction.user.id, 'raffle_enter', interaction.client);
    const { ticketLine } = require('../commands/raffle');
    const ticketNote = raffle.ticket_gp > 0 ? `\n${ticketLine(raffle.ticket_gp)}` : '';
    await interaction.reply({ content: `You're entered in **${raffle.title}** (${member.rsn}).${ticketNote}`, flags: 64 });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      await interaction.reply({ content: "You're already entered in this raffle!", flags: 64 });
    } else {
      await interaction.reply({ content: 'Failed to enter the raffle.', flags: 64 });
    }
  }
}

async function handlePagination(interaction) {
  const parts = interaction.customId.split(':');
  const type = parts[1];
  const page = parseInt(parts[2], 10);

  const { getPaginatedData, buildPagePayload } = require('../services/pagination');
  const data = await getPaginatedData(type, interaction.guildId, page);

  if (!data || data.items.length === 0) {
    return interaction.update({ content: 'No data to display.', embeds: [], components: [] });
  }

  await interaction.update(buildPagePayload(type, data, page, interaction.guildId));
}

async function handleConfirmation(interaction, db) {
  const parsed = parseConfirmationId(interaction.customId);
  if (!parsed) return;

  if (interaction.user.id !== parsed.requesterId) {
    return interaction.reply({ content: '❌ Only the person who initiated this action can confirm or cancel it.', flags: 64 });
  }

  if (interaction.customId.startsWith('cancel:')) {
    await interaction.update({ content: '❌ Action cancelled.', components: [] });
    return;
  }

  if (parsed.action === 'event_cancel') {
    const eventId = parseInt(parsed.targetId, 10);
    const event = await db.prepare('SELECT * FROM events WHERE id = ? AND guild_id = ?').get(eventId, interaction.guildId);
    const result = await db.prepare('DELETE FROM events WHERE id = ? AND guild_id = ?').run(eventId, interaction.guildId);
    if (result.changes > 0) {
      await interaction.update({ content: `✅ Event #${parsed.targetId} has been cancelled.`, components: [] });
      await audit(interaction.client, interaction.guildId, `Event #${parsed.targetId}${event ? ` (${event.title})` : ''} cancelled by <@${interaction.user.id}>`);
    } else {
      await interaction.update({ content: `❌ Event #${parsed.targetId} not found.`, components: [] });
    }
    return;
  }

  if (parsed.action === 'sotw_end') {
    const sotwId = parseInt(parsed.targetId, 10);
    const sotw = await db.prepare('SELECT * FROM sotw WHERE id = ? AND guild_id = ? AND ended = 0').get(sotwId, interaction.guildId);
    if (!sotw) {
      await interaction.update({ content: '❌ SOTW not found or already ended.', components: [] });
      return;
    }

    await interaction.update({ content: `⏳ Finalizing SOTW #${sotwId}...`, components: [] });

    const { finalizeSotw } = require('../services/reminders');
    await finalizeSotw(interaction.client, sotw);

    const sotwQueue = require('../services/sotwQueue');
    await sotwQueue.startNextQueuedSotw(interaction.guildId, interaction.client);

    await interaction.followUp(`✅ SOTW #${sotwId} (${sotw.skill.toUpperCase()}) has been ended. Results posted in the channel.`);
    await audit(interaction.client, interaction.guildId, `SOTW #${sotwId} (${sotw.skill}) ended by <@${interaction.user.id}>`);
  }
}

async function handleBingoReview(interaction, db) {
  const { isModerator } = require('../services/permissions');
  if (!isModerator(interaction.member)) {
    return interaction.reply({ content: 'Mods stamp tiles.', flags: 64 });
  }
  const [, bingoId, tileId, userId] = interaction.customId.split(':');
  const approve = interaction.customId.startsWith('bingo_ok:');
  const card = await require('../services/bingo').getBingo(interaction.guildId, Number(bingoId));
  const tile = (await require('../services/bingo').tilesOf(Number(bingoId))).find(t => t.id === Number(tileId));
  if (!card || !tile) return interaction.update({ content: 'Tile gone.', components: [] });

  if (approve) {
    const team = await require('../services/bingo').teamOf(card.id, userId);
    await require('../services/bingo').markComplete({
      bingo: card,
      tile,
      userId,
      teamId: team?.id,
      verifiedBy: interaction.user.id,
      status: 'complete',
      client: interaction.client,
    });
    await interaction.update({ content: `🟩 Approved **${tile.label}** for <@${userId}>.`, components: [] });
    await require('../services/live').refreshKind(interaction.client, interaction.guildId, 'bingo', card.id);
    return;
  }

  await db.prepare("UPDATE bingo_progress SET status = 'denied' WHERE bingo_id = ? AND tile_id = ? AND user_id = ?")
    .run(Number(bingoId), Number(tileId), userId);
  await interaction.update({ content: `Denied **${tile.label}** for <@${userId}>.`, components: [] });
  await require('../services/live').refreshKind(interaction.client, interaction.guildId, 'bingo', card.id);
}

module.exports = { handleButton };
