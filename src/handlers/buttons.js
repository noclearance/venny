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

  if (interaction.customId.startsWith('event_create:')) {
    return handleEventCreateButton(interaction);
  }
}

async function handleEventCreateButton(interaction) {
  const { isModerator } = require('../services/permissions');
  const ownerId = interaction.customId.split(':')[1];
  if (ownerId && ownerId !== interaction.user.id) {
    return interaction.reply({ content: 'That button is for the person who pinged me.', flags: 64 });
  }
  if (!isModerator(interaction.member)) {
    return interaction.reply({ content: 'Mods post masses.', flags: 64 });
  }
  const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
  const modal = new ModalBuilder().setCustomId('event_create_modal').setTitle('Create mass');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('title').setLabel('Short title').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('about').setLabel('What this actually is').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000).setPlaceholder('ToB, world 345, melee, bring scythe'),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('when').setLabel('When (e.g. 2026-08-25 19:00)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80),
    ),
  );
  return interaction.showModal(modal);
}

async function handleRaffleEnter(interaction, db) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: 64 });
  }
  const raffleId = parseInt(interaction.customId.replace('raffle_enter_', ''), 10);

  const raffle = await db.prepare('SELECT * FROM raffles WHERE id = ? AND guild_id = ? AND drawn = 0').get(raffleId, interaction.guildId);
  if (!raffle || !require('../services/raffleRun').stillOpen(raffle)) {
    return interaction.editReply({ content: 'This raffle is no longer active.' });
  }

  const member = await db.prepare('SELECT * FROM members WHERE guild_id = ? AND user_id = ?').get(interaction.guildId, interaction.user.id);
  if (!member) {
    return interaction.editReply({ content: 'Link your RSN first: `/me link`.' });
  }

  try {
    await db.prepare('INSERT INTO raffle_entries (raffle_id, user_id) VALUES (?, ?)').run(raffleId, interaction.user.id);
    await require('../services/economy').award(interaction.guildId, interaction.user.id, 'raffle_enter', interaction.client, raffleId);
    const { ticketLine } = require('../commands/raffle');
    const ticketNote = raffle.ticket_gp > 0 ? `\n${ticketLine(raffle.ticket_gp)}` : '';
    await interaction.editReply({ content: `You're entered in **${raffle.title}** (${member.rsn}).${ticketNote}` });
  } catch (err) {
    if (err.code === '23505' || /UNIQUE|duplicate key/i.test(err.message || '')) {
      await interaction.editReply({ content: "You're already entered in this raffle." });
    } else {
      console.error('Raffle enter failed:', err.message);
      await interaction.editReply({ content: 'Failed to enter the raffle.' });
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

    await interaction.followUp(`✅ SOTW #${sotwId} (${sotw.skill.toUpperCase()}) has been ended. Results posted in the channel.`);
    await audit(interaction.client, interaction.guildId, `SOTW #${sotwId} (${sotw.skill}) ended by <@${interaction.user.id}>`);
    return;
  }

  if (parsed.action === 'sotw_cancel') {
    const sotwId = parseInt(parsed.targetId, 10);
    const sotw = await db.prepare('SELECT * FROM sotw WHERE id = ? AND guild_id = ? AND ended = 0').get(sotwId, interaction.guildId);
    if (!sotw) {
      await interaction.update({ content: '❌ SOTW not found or already ended.', components: [] });
      return;
    }
    const settings = await db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(interaction.guildId);
    if (sotw.wom_competition_id && settings?.wom_verif_code) {
      try {
        await require('../services/wom').deleteCompetition(sotw.wom_competition_id, settings.wom_verif_code);
      } catch (err) {
        console.error('WOM delete on cancel:', err.message);
      }
    }
    await db.prepare('UPDATE sotw SET ended = 1, winner_rsn = ? WHERE id = ?').run('Cancelled', sotw.id);
    await db.prepare("UPDATE events SET reminder_sent = 1 WHERE guild_id = ? AND category = 'sotw' AND title LIKE ?")
      .run(interaction.guildId, `%${sotw.skill}%`);
    await interaction.update({ content: `SOTW **${sotw.skill}** is off. No winner.`, components: [] });
    await audit(interaction.client, interaction.guildId, `SOTW #${sotwId} (${sotw.skill}) cancelled by <@${interaction.user.id}>`);
    return;
  }

  if (parsed.action === 'sotw_queue_clear') {
    const count = await require('../services/sotwQueue').clearQueue(interaction.guildId);
    await interaction.update({
      content: `Cleared ${count} item${count === 1 ? '' : 's'} from the SOTW queue.`,
      components: [],
    });
    await audit(interaction.client, interaction.guildId, `SOTW queue cleared by <@${interaction.user.id}>`);
    return;
  }

  if (parsed.action === 'bingo_end') {
    const bingoId = parseInt(parsed.targetId, 10);
    const bingo = require('../services/bingo');
    const card = await bingo.getBingo(interaction.guildId, bingoId);
    if (!card || card.status === 'ended') {
      await interaction.update({ content: 'Board already closed or gone.', components: [] });
      return;
    }
    await db.prepare("UPDATE bingo_events SET status = 'ended', ended_at = datetime('now') WHERE id = ? AND guild_id = ?")
      .run(bingoId, interaction.guildId);
    await interaction.update({
      content: `Bingo #${bingoId} ended.`,
      embeds: [await bingo.boardEmbed(await bingo.getBingo(interaction.guildId, bingoId))],
      components: [],
    });
    await audit(interaction.client, interaction.guildId, `Bingo #${bingoId} ended by <@${interaction.user.id}>`);
    return;
  }

  if (parsed.action === 'raffle_draw' || parsed.action === 'raffle_end') {
    const id = parseInt(parsed.targetId, 10);
    const raffle = await db.prepare('SELECT * FROM raffles WHERE id = ? AND guild_id = ?').get(id, interaction.guildId);
    if (!raffle) {
      await interaction.update({ content: `Raffle #${id} not found.`, components: [] });
      return;
    }
    if (raffle.drawn) {
      await interaction.update({ content: `Raffle #${id} already closed.`, components: [] });
      return;
    }
    const mode = parsed.action === 'raffle_end' ? 'close' : 'draw';
    await interaction.update({ content: mode === 'close' ? `Closing raffle #${id}…` : `Drawing raffle #${id}…`, components: [] });
    const settled = await require('../services/raffleRun').settle(interaction.client, raffle, { mode });
    if (settled.skipped) {
      await interaction.followUp({ content: `Raffle #${id} was already closed.`, flags: 64 });
      return;
    }
    if (mode === 'close') {
      await interaction.followUp({ content: `Raffle #${id} **${raffle.title}** closed with no winner.`, flags: 64 });
      await audit(interaction.client, interaction.guildId, `Raffle #${id} **${raffle.title}** ended by <@${interaction.user.id}> (no winner)`);
      return;
    }
    if (settled.empty) {
      await interaction.followUp({ content: `Raffle #${id} had no entries. Closed with no winner.`, flags: 64 });
      return;
    }
    await interaction.followUp({ content: `Drawn. Winner is <@${settled.winner.user_id}>.`, flags: 64 });
    await audit(interaction.client, interaction.guildId, `Raffle #${id} **${raffle.title}** drawn by <@${interaction.user.id}> — winner <@${settled.winner.user_id}>`);
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
