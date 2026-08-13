const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const theme = require('./theme');
const bingo = require('./bingo');
const { templateKeys, getTemplate } = require('./bingoTemplates');

function badge(status) {
  if (status === 'draft') return 'DRAFT';
  if (status === 'active') return 'LIVE';
  if (status === 'paused') return 'PAUSED';
  if (status === 'locked' || status === 'ended') return 'LOCKED';
  return String(status || '').toUpperCase();
}

function draftEmbed(card) {
  const tiles = bingo.tilesOf(card.id);
  const max = bingo.capacityOf(card);
  const { grid, list } = bingo.boardText(card);
  const layout = card.layout === 'list' ? 'list' : `${card.size}×${card.size}`;
  const visual = card.layout === 'list' ? list : `${grid}\n\n${list}`;
  return theme.embed('raffle', {
    title: `${card.title}`,
    description: [
      theme.line('bingoDraft', card.id) || 'Paste a list or load a template. Don’t sit here running `/bingo tile` 25 times.',
      `**${badge(card.status)}** · ${tiles.length}/${max} tiles · ${layout} · #${card.id}`,
      '',
      visual.slice(0, 2800) || '_Empty board. Bulk paste or load a template._',
    ].join('\n'),
    footer: card.status === 'draft' ? 'Editable until you publish' : 'Published — tile list is locked',
  });
}

function draftComponents(card) {
  const locked = !bingo.isEditable(card);
  const id = card.id;
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`bg:bulk:${id}`).setLabel('Bulk paste').setStyle(ButtonStyle.Primary).setDisabled(locked),
    new ButtonBuilder().setCustomId(`bg:tpl:${id}`).setLabel('Load template').setStyle(ButtonStyle.Secondary).setDisabled(locked),
    new ButtonBuilder().setCustomId(`bg:prev:${id}`).setLabel('Preview').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`bg:edit:${id}`).setLabel('Edit one tile').setStyle(ButtonStyle.Secondary).setDisabled(locked),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`bg:imp:${id}`).setLabel('Import message').setStyle(ButtonStyle.Secondary).setDisabled(locked),
    new ButtonBuilder().setCustomId(`bg:swap:${id}`).setLabel('Swap tiles').setStyle(ButtonStyle.Secondary).setDisabled(locked),
    new ButtonBuilder().setCustomId(`bg:clear:${id}`).setLabel('Clear all').setStyle(ButtonStyle.Danger).setDisabled(locked),
    new ButtonBuilder().setCustomId(`bg:pub:${id}`).setLabel('Publish').setStyle(ButtonStyle.Success).setDisabled(card.status === 'active' || card.status === 'ended'),
  );
  return [row1, row2];
}

function templateSelect(cardId) {
  const options = templateKeys().map(key => {
    const tpl = getTemplate(key);
    return { label: tpl.name, value: key, description: tpl.hint.slice(0, 100) };
  });
  options.push({ label: 'Previous board in this server', value: 'previous', description: 'Copy the last board you ran' });
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`bg:tsel:${cardId}`)
      .setPlaceholder('Pick a template')
      .addOptions(options),
  );
}

function tileSelect(card) {
  const tiles = bingo.tilesOf(card.id);
  if (!tiles.length) return null;
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`bg:sel:${card.id}`)
      .setPlaceholder('Which square to edit?')
      .addOptions(tiles.slice(0, 25).map(t => ({
        label: `#${t.slot + 1} ${t.label}`.slice(0, 100),
        value: String(t.slot),
      }))),
  );
}

function bulkModal(cardId) {
  return new ModalBuilder()
    .setCustomId(`bg:mbulk:${cardId}`)
    .setTitle('Paste the whole board')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('list')
          .setLabel('One tile per line')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(4000)
          .setPlaceholder('1. 5 hard clues\n2. Clue pet drop\n3. Ranger boots'),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('mode')
          .setLabel('Default proof type if a line does not say')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(20)
          .setPlaceholder('screenshot  or  clues'),
      ),
    );
}

function tileModal(cardId, slot, tile) {
  return new ModalBuilder()
    .setCustomId(`bg:mtile:${cardId}:${slot}`)
    .setTitle(`Edit tile #${slot + 1}`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('label')
          .setLabel('What people have to do')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
          .setValue(tile?.label || ''),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('mode')
          .setLabel('Proof: screenshot, clues, kc, or xp')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(20)
          .setValue(tile?.verify_mode || 'screenshot'),
      ),
    );
}

function swapModal(cardId) {
  return new ModalBuilder()
    .setCustomId(`bg:mswap:${cardId}`)
    .setTitle('Swap two tiles')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('a').setLabel('First tile number').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('3'),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('b').setLabel('Second tile number').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('11'),
      ),
    );
}

function draftPayload(card) {
  return {
    embeds: [draftEmbed(card)],
    components: bingo.isEditable(card) || card.status === 'draft' ? draftComponents(card) : [],
  };
}

function liveComponents(card) {
  if (card.status !== 'active') return [];
  const id = card.id;
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bg:claim:${id}`).setLabel('Claim a tile').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`bg:mine:${id}`).setLabel('My tiles').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function livePayload(card) {
  return {
    embeds: [bingo.boardEmbed(card)],
    components: liveComponents(card),
  };
}

function claimSelect(card, userId) {
  const tiles = bingo.tilesOf(card.id);
  if (!tiles.length) return null;
  const progress = new Map(bingo.progressOf(card.id, userId).map(p => [p.tile_id, p.status]));
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`bg:csel:${card.id}`)
      .setPlaceholder('Which tile did you finish?')
      .addOptions(tiles.slice(0, 25).map(t => {
        const st = progress.get(t.id);
        const mark = st === 'complete' ? '✅ ' : st === 'pending' ? '🟨 ' : st === 'denied' ? '❌ ' : '';
        return {
          label: `${mark}#${t.slot + 1} ${t.label}`.slice(0, 100),
          value: String(t.slot),
          description: (bingo.isWomMode(t.verify_mode) ? 'Wise Old Man checks this' : 'Needs a screenshot').slice(0, 100),
        };
      })),
  );
}

function claimModal(cardId, slot) {
  return new ModalBuilder()
    .setCustomId(`bg:mclaim:${cardId}:${slot}`)
    .setTitle(`Claim tile #${slot + 1}`.slice(0, 45))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('proof')
          .setLabel('Screenshot link or what you got')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(400)
          .setPlaceholder('https://... or “ranger boots from a medium”'),
      ),
    );
}

function claimReviewRow(card, tile, userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`bingo_ok:${card.id}:${tile.id}:${userId}`).setLabel('Approve').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`bingo_no:${card.id}:${tile.id}:${userId}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
  );
}

module.exports = {
  badge,
  draftEmbed,
  draftComponents,
  draftPayload,
  liveComponents,
  livePayload,
  templateSelect,
  tileSelect,
  claimSelect,
  claimModal,
  claimReviewRow,
  bulkModal,
  tileModal,
  swapModal,
};
