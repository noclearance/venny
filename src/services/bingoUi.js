const bingo = require('./bingo');
const draft = require('./bingoDraft');
const { parseBingoList } = require('./bingoParser');
const { isModerator } = require('./permissions');
const live = require('./live');

const pendingImport = new Map();

const STAFF_ACTIONS = new Set(['bulk', 'tpl', 'edit', 'clear', 'swap', 'imp', 'pub', 'tsel', 'sel', 'mbulk', 'mtile', 'mswap', 'clr2']);

function staff(interaction) {
  return isModerator(interaction.member);
}

async function syncPostedBoard(interaction, card) {
  const fresh = bingo.getBingo(interaction.guildId, card.id);
  if (!fresh?.channel_id || !fresh.message_id) return;
  try {
    const channel = await interaction.client.channels.fetch(fresh.channel_id);
    const msg = await channel.messages.fetch(fresh.message_id);
    if (fresh.status === 'active') {
      await msg.edit(draft.livePayload(fresh));
    } else if (fresh.status === 'draft' || fresh.status === 'paused') {
      await msg.edit(draft.draftPayload(fresh));
    }
  } catch {
    // pin may have been deleted — leave it
  }
}

function replyFlags(interaction, payload) {
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply(payload);
}

async function handlePlayerClaim(interaction, card, tile, proof) {
  if (card.status !== 'active') {
    return replyFlags(interaction, { content: 'Bingo is not live.', flags: 64 });
  }
  const existing = bingo.progressOf(card.id, interaction.user.id).find(p => p.tile_id === tile.id);
  if (existing?.status === 'complete') {
    return replyFlags(interaction, { content: `You already have **${tile.label}**.`, flags: 64 });
  }

  if (bingo.isWomMode(tile.verify_mode)) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: 64 });
    }
    const result = await bingo.checkWomTile(card, tile, interaction.user.id);
    if (result.reason === 'need_rsn') {
      return interaction.editReply({ content: 'Link your RSN first: `/member link`.' });
    }
    if (result.reason === 'wom_fail') {
      return interaction.editReply({ content: 'Wise Old Man did not answer. Try again in a minute.' });
    }
    if (result.reason === 'baseline_set') {
      return interaction.editReply({
        content: `Saved **${result.rsn}**'s starting numbers. Do the tile, then claim again.`,
      });
    }
    if (result.ok) {
      bingo.claimTile({
        card,
        tile,
        userId: interaction.user.id,
        status: 'complete',
        verifiedBy: 'wom',
      });
      await interaction.editReply({ content: `🟩 **${tile.label}** stamped from Wise Old Man.` });
      await syncPostedBoard(interaction, card);
      return;
    }
    return interaction.editReply({
      content: `Not yet. **${tile.label}** is at **${result.gained}/${result.need}** since the board started.`,
    });
  }

  bingo.claimTile({
    card,
    tile,
    userId: interaction.user.id,
    proof: proof || null,
    status: 'pending',
  });
  await replyFlags(interaction, {
    content: `🟨 Claimed **${tile.label}**. Waiting on a mod.`,
    flags: 64,
  });
  await interaction.followUp({
    content: `🟨 **${tile.label}** claimed by ${interaction.user}.${proof ? `\n${proof}` : ''}`,
    components: [draft.claimReviewRow(card, tile, interaction.user.id)],
  });
}

function parseId(customId) {
  const parts = customId.split(':');
  return { action: parts[1], boardId: Number(parts[2]), extra: parts[3] };
}

function loadCard(interaction, boardId) {
  return bingo.getBingo(interaction.guildId, boardId);
}

async function refreshDraft(interaction, card, extra) {
  const fresh = bingo.getBingo(interaction.guildId, card.id);
  const payload = { ...draft.draftPayload(fresh), content: extra || null };
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload);
  }
  if (interaction.isModalSubmit() || interaction.isStringSelectMenu()) {
    return interaction.update(payload);
  }
  return interaction.update(payload);
}

async function handleBingoComponent(interaction) {
  const id = interaction.customId || '';
  if (!id.startsWith('bg:')) return false;

  const { action, boardId, extra } = parseId(id);
  const card = loadCard(interaction, boardId);
  if (!card) {
    const msg = { content: 'That board is gone.', flags: 64 };
    if (interaction.isRepliable()) await interaction.reply(msg).catch(() => {});
    return true;
  }

  if (STAFF_ACTIONS.has(action) && !staff(interaction)) {
    await interaction.reply({ content: 'Mods build the board.', flags: 64 });
    return true;
  }

  if (action === 'bulk') {
    await interaction.showModal(draft.bulkModal(card.id));
    return true;
  }
  if (action === 'tpl') {
    await interaction.reply({ content: 'Pick a preset.', components: [draft.templateSelect(card.id)], flags: 64 });
    return true;
  }
  if (action === 'prev') {
    await interaction.reply({ embeds: [bingo.boardEmbed(card)] });
    return true;
  }
  if (action === 'edit') {
    const menu = draft.tileSelect(card);
    if (!menu) {
      await interaction.reply({ content: 'No tiles yet. Bulk paste or load a template first.', flags: 64 });
      return true;
    }
    await interaction.reply({ content: 'Which square?', components: [menu], flags: 64 });
    return true;
  }
  if (action === 'clear') {
    await interaction.reply({
      content: `Clear every tile on **${card.title}**?`,
      flags: 64,
      components: [{
        type: 1,
        components: [{
          type: 2,
          style: 4,
          custom_id: `bg:clr2:${card.id}`,
          label: 'Yes, wipe it',
        }],
      }],
    });
    return true;
  }
  if (action === 'clr2') {
    if (!bingo.isEditable(card)) {
      await interaction.reply({ content: 'Board is locked.', flags: 64 });
      return true;
    }
    bingo.replaceTiles(card.id, []);
    await interaction.update({ content: 'Board wiped.', components: [] });
    await syncPostedBoard(interaction, card);
    return true;
  }
  if (action === 'swap') {
    await interaction.showModal(draft.swapModal(card.id));
    return true;
  }
  if (action === 'imp') {
    pendingImport.set(interaction.user.id, { boardId: card.id, guildId: interaction.guildId, expires: Date.now() + 60_000 });
    await interaction.reply({
      content: 'Post the tile list in this channel in the next 60 seconds (or reply to a message and run `/bingo import`).',
      flags: 64,
    });
    return true;
  }
  if (action === 'pub') {
    if (card.status === 'ended') {
      await interaction.reply({ content: 'Already closed.', flags: 64 });
      return true;
    }
    await interaction.deferUpdate();
    const { getDb } = require('../db/database');
    getDb().prepare("UPDATE bingo_events SET status = 'active', started_at = datetime('now') WHERE id = ?").run(card.id);
    await bingo.snapshotBaselines(card, interaction.guildId);
    const fresh = bingo.getBingo(interaction.guildId, card.id);
    const msg = await interaction.followUp({
      content: 'Board is live. **Claim a tile** on the board, or `/bingo submit`. WOM tiles stamp themselves.',
      ...draft.livePayload(fresh),
    });
    live.pin(interaction.guildId, 'bingo', card.id, interaction.channelId, msg.id);
    bingo.saveMessage(card.id, interaction.channelId, msg.id);
    return true;
  }

  if (action === 'claim') {
    if (card.status !== 'active') {
      await interaction.reply({ content: 'Board is not live.', flags: 64 });
      return true;
    }
    const menu = draft.claimSelect(card, interaction.user.id);
    if (!menu) {
      await interaction.reply({ content: 'No tiles on this board.', flags: 64 });
      return true;
    }
    await interaction.reply({ content: 'Pick the square you finished.', components: [menu], flags: 64 });
    return true;
  }

  if (action === 'mine') {
    const tiles = bingo.tilesOf(card.id);
    const byTile = new Map(bingo.progressOf(card.id, interaction.user.id).map(p => [p.tile_id, p]));
    const lines = tiles.map(t => {
      const st = byTile.get(t.id)?.status;
      const mark = st === 'complete' ? '✅' : st === 'pending' ? '🟨' : st === 'denied' ? '❌' : '⬜';
      return `${mark} **${t.slot + 1}.** ${t.label}`;
    });
    await interaction.reply({
      content: lines.join('\n').slice(0, 1800) || 'Empty board.',
      flags: 64,
    });
    return true;
  }

  if (action === 'csel') {
    const slot = Number(interaction.values?.[0]);
    const tile = bingo.tilesOf(card.id).find(t => t.slot === slot);
    if (!tile) {
      await interaction.reply({ content: 'That tile is gone.', flags: 64 });
      return true;
    }
    if (bingo.isWomMode(tile.verify_mode)) {
      await handlePlayerClaim(interaction, card, tile, null);
      return true;
    }
    await interaction.showModal(draft.claimModal(card.id, slot));
    return true;
  }

  if (action === 'tsel') {
    const key = extra || interaction.values?.[0];
    if (!bingo.isEditable(card)) {
      await interaction.reply({ content: 'Board is locked.', flags: 64 });
      return true;
    }
    if (key === 'previous') {
      const prev = bingo.lastGuildBoard(interaction.guildId, card.id);
      if (!prev) {
        await interaction.reply({ content: 'No previous board in this server.', flags: 64 });
        return true;
      }
      const n = bingo.copyTilesFrom(prev.id, card.id, bingo.capacityOf(card));
      await interaction.update({ content: `Copied ${n} tiles from **${prev.title}**.`, components: [] });
      await syncPostedBoard(interaction, card);
      return true;
    }
    const result = bingo.applyTemplate(card, key);
    if (!result.ok) {
      await interaction.reply({ content: result.error, flags: 64 });
      return true;
    }
    await interaction.update({ content: `Loaded **${key}** (${result.loaded} tiles).`, components: [] });
    await syncPostedBoard(interaction, card);
    return true;
  }

  if (action === 'sel') {
    const slot = Number(interaction.values?.[0]);
    const tile = bingo.tilesOf(card.id).find(t => t.slot === slot);
    await interaction.showModal(draft.tileModal(card.id, slot, tile));
    return true;
  }

  return true;
}

async function handleBingoModal(interaction) {
  const id = interaction.customId || '';
  if (!id.startsWith('bg:')) return false;
  const parts = id.split(':');
  const action = parts[1];
  const boardId = Number(parts[2]);
  const card = bingo.getBingo(interaction.guildId, boardId);
  if (!card) {
    await interaction.reply({ content: 'That board is gone.', flags: 64 });
    return true;
  }
  if (action === 'mclaim') {
    const slot = Number(parts[3]);
    const tile = bingo.tilesOf(card.id).find(t => t.slot === slot);
    if (!tile) {
      await interaction.reply({ content: 'That tile is gone.', flags: 64 });
      return true;
    }
    const proof = interaction.fields.getTextInputValue('proof');
    await handlePlayerClaim(interaction, card, tile, proof);
    return true;
  }

  if (!staff(interaction)) {
    await interaction.reply({ content: 'Mods build the board.', flags: 64 });
    return true;
  }
  if (!bingo.isEditable(card)) {
    await interaction.reply({ content: 'Board is locked. Pause it if you need to edit.', flags: 64 });
    return true;
  }

  if (action === 'mbulk') {
    const list = interaction.fields.getTextInputValue('list');
    const mode = interaction.fields.getTextInputValue('mode');
    const parsed = parseBingoList(list, { defaultMode: mode, maxTiles: bingo.capacityOf(card) });
    bingo.replaceTiles(card.id, parsed.tiles);
    const fail = parsed.errors.length
      ? ` Lines ${parsed.errors.map(e => e.line).join(', ')} failed.`
      : '';
    await interaction.reply({
      content: `Loaded **${parsed.loaded}** tiles.${fail}`,
      flags: 64,
      embeds: [draft.draftEmbed(bingo.getBingo(interaction.guildId, card.id))],
    });
    await syncPostedBoard(interaction, card);
    return true;
  }

  if (action === 'mtile') {
    const slot = Number(parts[3]);
    const label = interaction.fields.getTextInputValue('label');
    const { inferFromLabel, resolveMode } = require('./bingoParser');
    const inferred = inferFromLabel(label);
    const mode = resolveMode(interaction.fields.getTextInputValue('mode')) || inferred.verify_mode;
    bingo.setTile(card.id, slot, {
      label,
      verifyMode: mode,
      metric: inferred.metric,
      amount: inferred.amount,
    });
    await interaction.reply({ content: `Updated tile #${slot + 1}.`, flags: 64, embeds: [draft.draftEmbed(bingo.getBingo(interaction.guildId, card.id))] });
    await syncPostedBoard(interaction, card);
    return true;
  }

  if (action === 'mswap') {
    const a = Number(interaction.fields.getTextInputValue('a')) - 1;
    const b = Number(interaction.fields.getTextInputValue('b')) - 1;
    const ok = bingo.swapTiles(card.id, a, b);
    await interaction.reply({
      content: ok ? `Swapped #${a + 1} and #${b + 1}.` : 'Those slot numbers are not on the board.',
      flags: 64,
      embeds: ok ? [draft.draftEmbed(bingo.getBingo(interaction.guildId, card.id))] : undefined,
    });
    if (ok) await syncPostedBoard(interaction, card);
    return true;
  }

  return true;
}

async function ingestList(interaction, card, text) {
  const parsed = parseBingoList(text, { maxTiles: bingo.capacityOf(card) });
  bingo.replaceTiles(card.id, parsed.tiles);
  const fail = parsed.errors.length
    ? ` Lines ${parsed.errors.map(e => e.line).join(', ')} failed.`
    : '';
  return `Loaded **${parsed.loaded}** tiles.${fail}`;
}

function takePendingImport(userId) {
  const row = pendingImport.get(userId);
  if (!row) return null;
  if (row.expires < Date.now()) {
    pendingImport.delete(userId);
    return null;
  }
  pendingImport.delete(userId);
  return row;
}

module.exports = {
  handleBingoComponent,
  handleBingoModal,
  handlePlayerClaim,
  ingestList,
  takePendingImport,
  pendingImport,
  syncPostedBoard,
};
