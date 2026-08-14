const {
  SlashCommandBuilder,
  ContextMenuCommandBuilder,
  ApplicationCommandType,
} = require('discord.js');
const { getDb } = require('../db/database');
const theme = require('../services/theme');
const bingo = require('../services/bingo');
const draft = require('../services/bingoDraft');
const bingoUi = require('../services/bingoUi');
const live = require('../services/live');
const { isModerator } = require('../services/permissions');
const { inferFromLabel, resolveMode } = require('../services/bingoParser');
const { filterChoices, respond } = require('../services/autocomplete');

// Typical flow:
// 1. /bingo create  → draft with buttons
// 2. Bulk paste or Load template (clues)
// 3. Publish
// 4. Players hit Claim a tile on the live board (or /bingo submit)
// /bingo tile stays as a one-square scalpel.
// /bingo verify stays as the mod stamp.

const LABEL_SUGGESTIONS = [
  '5 hard clues', '10 easy clues', '10 medium clues', '3 elite clues', '1 master clue',
  '15 clues any tier', 'Clue pet drop', '3rd age drop', 'Ranger boots', 'Wizard boots',
  'Holy sandals', 'Uri emote clue', 'Master clue stash fill', 'Hard clue screenshot',
  'Beginner clue casket', 'Gilded item', 'Any boss pet', 'Any skilling pet',
];

const MODE_SUGGESTIONS = [
  { name: 'screenshot — they prove it', value: 'screenshot' },
  { name: 'drop — screenshot of the drop', value: 'drop' },
  { name: 'stash — STASH unit fill', value: 'stash' },
  { name: 'emote — emote clue', value: 'emote' },
  { name: 'any — any proof is fine', value: 'any' },
  { name: 'count — clue counts from WOM', value: 'count' },
  { name: 'clues — Wise Old Man clue counts', value: 'wom_activity' },
  { name: 'kc — boss kills from WOM', value: 'wom_kc' },
  { name: 'xp — skill XP from WOM', value: 'wom_xp' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bingo')
    .setDescription('Clan bingo — paste a list or load a template, do not type 25 tiles')
    .addSubcommand(sub =>
      sub.setName('create')
        .setDescription('Open a draft board you can paste into')
        .addStringOption(opt => opt.setName('name').setDescription('Board name'))
        .addStringOption(opt => opt.setName('size').setDescription('How the board looks').addChoices(
          { name: '5 by 5 grid (25 tiles)', value: '5' },
          { name: '4 by 4 grid (16 tiles)', value: '4' },
          { name: 'Just a list (up to 25)', value: 'list' },
        ))
        .addStringOption(opt => opt.setName('start_from').setDescription('Optional preset so you are not starting blank').addChoices(
          { name: 'Empty — I will paste my own', value: 'blank' },
          { name: 'Clue scroll board', value: 'clues' },
          { name: 'Harder clue board', value: 'clues-hardcore' },
          { name: 'Boots and pets', value: 'boots-and-pets' },
          { name: 'Light PvM', value: 'pvm-lite' },
          { name: 'Mixed casual week', value: 'mixed-casual' },
        )))
    .addSubcommand(sub =>
      sub.setName('template')
        .setDescription('Load a full preset onto the current draft')
        .addStringOption(opt => opt.setName('which').setDescription('Preset').setRequired(true).addChoices(
          { name: 'Clue scroll board', value: 'clues' },
          { name: 'Harder clue board', value: 'clues-hardcore' },
          { name: 'Boots and pets', value: 'boots-and-pets' },
          { name: 'Light PvM', value: 'pvm-lite' },
          { name: 'Mixed casual week', value: 'mixed-casual' },
          { name: 'Last board this server used', value: 'previous' },
        )))
    .addSubcommand(sub =>
      sub.setName('import')
        .setDescription('Load tiles from a Discord message you already posted')
        .addStringOption(opt => opt.setName('message_id').setDescription('Message ID, or leave blank and post the list next')))
    .addSubcommand(sub =>
      sub.setName('board')
        .setDescription('Show the current bingo board')
        .addIntegerOption(opt => opt.setName('id').setDescription('Board number if there is more than one')))
    .addSubcommand(sub =>
      sub.setName('start').setDescription('Lock the draft and go live'))
    .addSubcommand(sub =>
      sub.setName('pause').setDescription('Pause a live board so it can be edited'))
    .addSubcommand(sub =>
      sub.setName('end').setDescription('Close the board for good'))
    .addSubcommand(sub =>
      sub.setName('tile')
        .setDescription('Change one square — use bulk paste for a whole board')
        .addIntegerOption(opt => opt.setName('slot').setDescription('Tile number starting at 1').setRequired(true).setMinValue(1).setMaxValue(25))
        .addStringOption(opt => opt.setName('label').setDescription('What they have to do').setRequired(true).setAutocomplete(true))
        .addStringOption(opt => opt.setName('mode').setDescription('How they prove it').setAutocomplete(true))
        .addStringOption(opt => opt.setName('metric').setDescription('Only if Wise Old Man tracks it, e.g. zulrah'))
        .addIntegerOption(opt => opt.setName('amount').setDescription('How many XP / KC / clues')))
    .addSubcommand(sub =>
      sub.setName('submit')
        .setDescription('Claim a tile you finished')
        .addIntegerOption(opt => opt.setName('slot').setDescription('Tile number starting at 1').setRequired(true).setMinValue(1).setMaxValue(25).setAutocomplete(true))
        .addStringOption(opt => opt.setName('proof').setDescription('Screenshot link or what you got')))
    .addSubcommand(sub =>
      sub.setName('verify')
        .setDescription('Approve someone else, or claim a tile the old way')
        .addIntegerOption(opt => opt.setName('slot').setDescription('Tile number starting at 1').setRequired(true).setMinValue(1).setAutocomplete(true))
        .addStringOption(opt => opt.setName('proof').setDescription('Screenshot link or note'))
        .addUserOption(opt => opt.setName('for').setDescription('Approve this person (mods)'))
        .addBooleanOption(opt => opt.setName('approve').setDescription('Mod: stamp it complete')))
    .addSubcommand(sub =>
      sub.setName('team')
        .setDescription('Create or join a team')
        .addStringOption(opt => opt.setName('action').setDescription('What to do').setRequired(true).addChoices(
          { name: 'Create a team (mods)', value: 'create' },
          { name: 'Join a team', value: 'join' },
          { name: 'Show teams', value: 'list' },
        ))
        .addStringOption(opt => opt.setName('name').setDescription('Team name'))
        .addIntegerOption(opt => opt.setName('id').setDescription('Team number to join')))
    .addSubcommand(sub =>
      sub.setName('leaderboard')
        .setDescription('Team scores')),

  contextData: new ContextMenuCommandBuilder()
    .setName('Import as bingo list')
    .setType(ApplicationCommandType.Message),

  staffSubs: ['create', 'start', 'pause', 'end', 'tile', 'template', 'import'],

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const db = getDb();

    if (sub === 'create') {
      const title = interaction.options.getString('name') || 'Clan bingo';
      const sizeOpt = interaction.options.getString('size') || '5';
      const startFrom = interaction.options.getString('start_from') || 'blank';
      const card = bingo.createBingo({
        guildId: interaction.guildId,
        title,
        themeName: startFrom === 'blank' ? 'blank' : startFrom,
        size: sizeOpt === 'list' ? 5 : Number(sizeOpt),
        layout: sizeOpt === 'list' ? 'list' : 'grid',
        createdBy: interaction.user.id,
        channelId: interaction.channelId,
        empty: startFrom === 'blank',
      });
      if (startFrom !== 'blank' && startFrom !== 'previous') {
        bingo.applyTemplate(card, startFrom);
      }
      const fresh = bingo.getBingo(interaction.guildId, card.id);
      const reply = await interaction.reply({
        content: startFrom === 'blank'
          ? 'Draft is open. **Bulk paste** or **Load template**. That is the fast path.'
          : `Draft loaded from **${startFrom}**. Tweak then Publish.`,
        ...draft.draftPayload(fresh),
        fetchReply: true,
      });
      bingo.saveMessage(fresh.id, interaction.channelId, reply.id);
      return;
    }

    const card = bingo.getBingo(interaction.guildId, interaction.options.getInteger('id'));
    if (!card) {
      return interaction.reply({ content: 'No bingo on the books. `/bingo create`.', flags: 64 });
    }

    if (sub === 'template') {
      if (!bingo.isEditable(card)) {
        return interaction.reply({ content: 'Pause or stay in draft to change tiles.', flags: 64 });
      }
      const which = interaction.options.getString('which');
      if (which === 'previous') {
        const prev = bingo.lastGuildBoard(interaction.guildId, card.id);
        if (!prev) return interaction.reply({ content: 'No earlier board here.', flags: 64 });
        const n = bingo.copyTilesFrom(prev.id, card.id, bingo.capacityOf(card));
        const copied = bingo.getBingo(interaction.guildId, card.id);
        await interaction.reply({ content: `Copied ${n} tiles from **${prev.title}**.`, ...draft.draftPayload(copied), flags: 64 });
        await bingoUi.syncPostedBoard(interaction, copied);
        return;
      }
      const result = bingo.applyTemplate(card, which);
      const loaded = bingo.getBingo(interaction.guildId, card.id);
      await interaction.reply({
        content: result.ok ? `Loaded **${which}** (${result.loaded} tiles).` : result.error,
        ...draft.draftPayload(loaded),
        flags: 64,
      });
      if (result.ok) await bingoUi.syncPostedBoard(interaction, loaded);
      return;
    }

    if (sub === 'import') {
      if (!bingo.isEditable(card)) {
        return interaction.reply({ content: 'Board is locked.', flags: 64 });
      }
      const messageId = interaction.options.getString('message_id');
      if (!messageId) {
        bingoUi.pendingImport.set(interaction.user.id, {
          boardId: card.id,
          guildId: interaction.guildId,
          expires: Date.now() + 60_000,
        });
        return interaction.reply({ content: 'Post the list in this channel within 60 seconds.', flags: 64 });
      }
      try {
        const msg = await interaction.channel.messages.fetch(messageId);
        const note = await bingoUi.ingestList(interaction, card, msg.content);
        const imported = bingo.getBingo(interaction.guildId, card.id);
        await interaction.reply({ content: note, flags: 64, ...draft.draftPayload(imported) });
        await bingoUi.syncPostedBoard(interaction, imported);
        return;
      } catch {
        return interaction.reply({ content: 'Could not read that message ID in this channel.', flags: 64 });
      }
    }

    if (sub === 'board') {
      if (card.status === 'draft' && isModerator(interaction.member)) {
        const reply = await interaction.reply({ ...draft.draftPayload(card), fetchReply: true });
        bingo.saveMessage(card.id, interaction.channelId, reply.id);
        return;
      }
      const reply = await interaction.reply({ ...draft.livePayload(card), fetchReply: true });
      if (isModerator(interaction.member) && card.status === 'active') {
        live.pin(interaction.guildId, 'bingo', card.id, interaction.channelId, reply.id);
        bingo.saveMessage(card.id, interaction.channelId, reply.id);
      }
      return;
    }

    if (sub === 'start') {
      await interaction.deferReply();
      db.prepare("UPDATE bingo_events SET status = 'active', started_at = datetime('now') WHERE id = ?").run(card.id);
      await bingo.snapshotBaselines(card, interaction.guildId);
      const fresh = bingo.getBingo(interaction.guildId, card.id);
      const msg = await interaction.editReply({
        content: 'Board is live. **Claim a tile** on the board, or `/bingo submit`. WOM tiles stamp themselves.',
        ...draft.livePayload(fresh),
      });
      live.pin(interaction.guildId, 'bingo', card.id, interaction.channelId, msg.id);
      bingo.saveMessage(card.id, interaction.channelId, msg.id);
      await require('../services/announce').broadcast(interaction.client, interaction.guildId, {
        kind: 'raffle',
        title: `${fresh.title} is live`,
        description: 'Bingo is up. Claim a tile on the board, or `/bingo submit`. WOM tiles stamp themselves.',
        fields: [require('../services/theme').field('Credits', require('../services/economy').payNote('bingo_tile'))],
        sourceChannelId: interaction.channelId,
        sourceMessageId: msg.id,
      });
      return;
    }

    if (sub === 'pause') {
      db.prepare("UPDATE bingo_events SET status = 'paused' WHERE id = ?").run(card.id);
      const reply = await interaction.reply({
        content: 'Paused. You can edit again.',
        ...draft.draftPayload(bingo.getBingo(interaction.guildId, card.id)),
        fetchReply: true,
      });
      bingo.saveMessage(card.id, interaction.channelId, reply.id);
      return;
    }

    if (sub === 'end') {
      db.prepare("UPDATE bingo_events SET status = 'ended', ended_at = datetime('now') WHERE id = ?").run(card.id);
      return interaction.reply({ embeds: [bingo.boardEmbed(bingo.getBingo(interaction.guildId, card.id))] });
    }

    if (sub === 'tile') {
      if (!bingo.isEditable(card) && card.status !== 'paused') {
        return interaction.reply({ content: 'Board is locked. Pause it to edit.', flags: 64 });
      }
      const slot = interaction.options.getInteger('slot') - 1;
      const label = interaction.options.getString('label');
      const inferred = inferFromLabel(label);
      bingo.setTile(card.id, slot, {
        label,
        verifyMode: resolveMode(interaction.options.getString('mode')) || inferred.verify_mode,
        metric: interaction.options.getString('metric') || inferred.metric,
        amount: interaction.options.getInteger('amount') || inferred.amount || 0,
      });
      const updated = bingo.getBingo(interaction.guildId, card.id);
      await interaction.reply({ content: `Updated #${slot + 1}.`, flags: 64, ...draft.draftPayload(updated) });
      await bingoUi.syncPostedBoard(interaction, updated);
      return;
    }

    if (sub === 'submit') {
      const slot = interaction.options.getInteger('slot') - 1;
      const tile = bingo.tilesOf(card.id).find(t => t.slot === slot);
      if (!tile) return interaction.reply({ content: 'No tile in that slot.', flags: 64 });
      return bingoUi.handlePlayerClaim(interaction, card, tile, interaction.options.getString('proof'));
    }

    if (sub === 'verify') {
      const slot = interaction.options.getInteger('slot') - 1;
      const tile = bingo.tilesOf(card.id).find(t => t.slot === slot);
      if (!tile) return interaction.reply({ content: 'No tile in that slot.', flags: 64 });
      if (card.status !== 'active') return interaction.reply({ content: 'Bingo is not live.', flags: 64 });

      const approve = interaction.options.getBoolean('approve');
      const target = interaction.options.getUser('for') || interaction.user;
      if ((approve || target.id !== interaction.user.id) && !isModerator(interaction.member)) {
        return interaction.reply({ content: 'Only mods stamp tiles for other people.', flags: 64 });
      }

      if (approve) {
        bingo.claimTile({
          card,
          tile,
          userId: target.id,
          proof: interaction.options.getString('proof'),
          verifiedBy: interaction.user.id,
          status: 'complete',
          client: interaction.client,
        });
        await interaction.reply({ content: `🟩 Stamped **${tile.label}** for ${target}.`, ...draft.livePayload(bingo.getBingo(interaction.guildId, card.id)) });
        await bingoUi.syncPostedBoard(interaction, card);
        return;
      }

      if (target.id === interaction.user.id) {
        return bingoUi.handlePlayerClaim(interaction, card, tile, interaction.options.getString('proof'));
      }

      bingo.claimTile({
        card,
        tile,
        userId: target.id,
        proof: interaction.options.getString('proof'),
        status: 'pending',
      });
      return interaction.reply({
        content: `🟨 **${tile.label}** claimed for ${target}. Mods approve if the proof is real.`,
        components: [draft.claimReviewRow(card, tile, target.id)],
      });
    }

    if (sub === 'team') {
      const action = interaction.options.getString('action');
      if (action === 'list' || !action) {
        const teams = bingo.listTeams(card.id);
        return interaction.reply({
          embeds: [theme.embed('raffle', {
            title: `Teams · ${card.title}`,
            description: teams.map(t => `**#${t.id} ${t.name}** — ${t.members.length} · ${t.completed} tiles`).join('\n') || 'None.',
          })],
          flags: 64,
        });
      }
      if (action === 'create') {
        if (!isModerator(interaction.member)) {
          return interaction.reply({ content: 'Mods create teams. Use join.', flags: 64 });
        }
        const name = interaction.options.getString('name');
        if (!name) return interaction.reply({ content: 'Give it a name.', flags: 64 });
        const id = bingo.createTeam(card.id, name, interaction.user.id);
        bingo.joinTeam(id, interaction.user.id);
        return interaction.reply({ content: `Team **${name}** is #${id}. You are on it.`, flags: 64 });
      }
      if (action === 'join') {
        const id = interaction.options.getInteger('id');
        const name = interaction.options.getString('name');
        let teamId = id;
        if (!teamId && name) {
          const match = bingo.listTeams(card.id).find(t => t.name.toLowerCase() === name.toLowerCase());
          teamId = match?.id;
        }
        if (!teamId) return interaction.reply({ content: 'Need a team number or name.', flags: 64 });
        const team = bingo.joinTeam(teamId, interaction.user.id);
        return interaction.reply({ content: team ? `You're on **${team.name}**.` : 'No such team.', flags: 64 });
      }
    }

    if (sub === 'leaderboard') {
      const teams = bingo.listTeams(card.id).sort((a, b) => b.completed - a.completed);
      return interaction.reply({
        embeds: [theme.embed('raffle', {
          title: `Bingo standings · ${card.title}`,
          description: theme.rankLines(teams, t => `**${t.name}** — ${t.completed} tiles · ${t.members.length} people`) || 'No teams.',
        })],
        flags: 64,
      });
    }
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'label') {
      return respond(interaction, filterChoices(LABEL_SUGGESTIONS, focused.value, label => ({ name: label, value: label })));
    }
    if (focused.name === 'mode') {
      return respond(interaction, filterChoices(MODE_SUGGESTIONS, focused.value, m => m));
    }
    if (focused.name === 'slot') {
      const card = bingo.getBingo(interaction.guildId);
      const tiles = card ? bingo.tilesOf(card.id) : [];
      return respond(interaction, filterChoices(tiles, focused.value, t => ({
        name: `#${t.slot + 1} ${t.label}`,
        value: t.slot + 1,
      })));
    }
    return respond(interaction, []);
  },

  async executeContext(interaction) {
    if (!isModerator(interaction.member)) {
      return interaction.reply({ content: 'Mods import boards.', flags: 64 });
    }
    const card = bingo.activeBingo(interaction.guildId);
    if (!card || !bingo.isEditable(card)) {
      return interaction.reply({ content: 'Open a draft with `/bingo create` first.', flags: 64 });
    }
    const text = interaction.targetMessage?.content || '';
    const note = await bingoUi.ingestList(interaction, card, text);
    const imported = bingo.getBingo(interaction.guildId, card.id);
    await interaction.reply({ content: note, flags: 64, ...draft.draftPayload(imported) });
    await bingoUi.syncPostedBoard(interaction, imported);
  },
};
