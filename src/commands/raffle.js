const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getDb } = require('../db/database');
const { isModerator } = require('../services/permissions');
const { getPaginatedData, buildPagePayload } = require('../services/pagination');
const { audit } = require('../services/audit');

const DEFAULT_TICKET_GP = 150_000;

function ticketLine(gp = DEFAULT_TICKET_GP) {
  const n = Number(gp);
  if (!Number.isFinite(n) || n <= 0) return 'Free entry. Linked RSN required.';
  return `Tickets are **${n.toLocaleString()}** GP each, paid in game. Settle the gold with staff, then tap Enter.`;
}

module.exports = {
  DEFAULT_TICKET_GP,
  ticketLine,
  data: new SlashCommandBuilder()
    .setName('raffle')
    .setDescription('Clan raffles — set hours (or until), then I draw')
    .addSubcommand(sub => {
      sub.setName('create')
        .setDescription('Create a new raffle with a button for entries')
        .addStringOption(opt => opt.setName('title').setDescription('Raffle title').setRequired(true))
        .addIntegerOption(opt =>
          opt.setName('hours')
            .setDescription('How long entries stay open (then I draw)')
            .setMinValue(1)
            .setMaxValue(720))
        .addStringOption(opt =>
          opt.setName('prize')
            .setDescription('What they win — 50m, Twisted Bow')
            .setRequired(false)
            .setMaxLength(200))
        .addStringOption(opt =>
          opt.setName('until')
            .setDescription('Optional exact close time (overrides hours), e.g. 2026-08-24 19:00'))
        .addIntegerOption(opt =>
          opt.setName('ticket_gp')
            .setDescription('In-game gold per ticket (default 150000)')
            .setMinValue(0)
            .setMaxValue(2_147_000_000))
        .addStringOption(opt =>
          opt.setName('weight_mode')
            .setDescription('Weight entries by activity (default: none)')
            .setRequired(false)
            .addChoices(
              { name: 'None (equal chance)', value: 'none' },
              { name: 'SOTW wins', value: 'sotw' },
              { name: 'Event attendance (this server)', value: 'attendance' },
              { name: 'Combined (wins + attendance)', value: 'activity' },
            ));
      return require('../services/subscriptions').addPingOptions(sub);
    })
    .addSubcommand(sub =>
      sub.setName('entries')
        .setDescription('Show how many entries a raffle has')
        .addIntegerOption(opt => opt.setName('id').setDescription('Which raffle').setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub =>
      sub.setName('draw')
        .setDescription('Draw a random winner from the entries')
        .addIntegerOption(opt => opt.setName('id').setDescription('Which raffle').setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub =>
      sub.setName('end')
        .setDescription('Close a raffle without drawing a winner')
        .addIntegerOption(opt => opt.setName('id').setDescription('Which raffle').setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List all raffles in this server'))
    .addSubcommand(sub =>
      sub.setName('history')
        .setDescription('Show raffle win history and stats')
        .addUserOption(opt => opt.setName('user').setDescription('Show stats for a specific user').setRequired(false))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const db = getDb();

    if (['create', 'draw', 'end'].includes(sub) && !isModerator(interaction.member)) {
      return interaction.reply({ content: '❌ You need **Manage Events**, **Manage Server**, or **Administrator** permission to manage raffles.', flags: 64 });
    }

    if (sub === 'create') {
      const pingOpts = require('../services/subscriptions').pingFromInteraction(interaction);
      try {
        require('../services/subscriptions').assertCanPing(interaction.member, interaction.guild.members.me, pingOpts);
      } catch (err) {
        return require('../services/commandFail').commandFail(interaction, err);
      }
      const title = interaction.options.getString('title');
      const economy = require('../services/economy');
      const loot = economy.clipPrize(interaction.options.getString('prize'));
      const description = loot || '';
      const weightMode = interaction.options.getString('weight_mode') || 'none';
      const ticketGp = interaction.options.getInteger('ticket_gp') ?? DEFAULT_TICKET_GP;
      const hours = interaction.options.getInteger('hours');
      const untilStr = interaction.options.getString('until');
      if (!hours && !untilStr) {
        return require('../services/commandFail').commandFail(interaction, 'Give **hours** or **until**.');
      }

      let endsAt;
      if (untilStr) {
        const { parseEventDate } = require('../services/timezone');
        const parsed = await parseEventDate(untilStr, interaction.guildId);
        if (!parsed.date) {
          return require('../services/commandFail').commandFail(interaction, parsed.error);
        }
        if (parsed.date <= new Date()) {
          return require('../services/commandFail').commandFail(
            interaction,
            `Close time is already past (${require('../services/theme').when(parsed.date.toISOString())}).`,
          );
        }
        endsAt = parsed.date;
      } else {
        endsAt = new Date(Date.now() + hours * 60 * 60 * 1000);
      }
      const endsIso = endsAt.toISOString();

      const result = await db.prepare(`
        INSERT INTO raffles (guild_id, title, description, channel_id, created_by, weight_mode, ticket_gp, ends_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(interaction.guildId, title, description, interaction.channelId, interaction.user.id, weightMode, ticketGp, endsIso);

      const raffleId = result.lastInsertRowid;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`raffle_enter_${raffleId}`)
          .setLabel('Enter Raffle')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🎟️')
      );

      const theme = require('../services/theme');
      const ticket = ticketGp > 0 ? `${ticketGp.toLocaleString()} GP` : 'Free';
      const how = ticketLine(ticketGp);
      const fields = [
        theme.prizeField(economy.prizeLine('raffle_win', loot)),
        theme.field('Ticket', ticket, true),
        theme.field('Closes', theme.when(endsIso), true),
        theme.field('Odds', weightMode !== 'none' ? `Weighted by ${weightMode}` : 'Equal', true),
        theme.field('How to enter', how),
      ];
      const made = require('../services/cards').venny('raffle', {
        job: 'raffle_start',
        facts: { title, prize: loot || null, weighted: weightMode !== 'none', hours },
        fallbackTitle: title,
        fallbackDescription: theme.line('raffleOpen', raffleId),
        fields,
        footer: `Raffle #${raffleId}  ·  Misclickers`,
        timestamp: true,
      });
      const ping = await require('../services/subscriptions').mentionFor({
        guildId: interaction.guildId,
        category: 'raffle',
        mode: pingOpts.mode,
        roleId: pingOpts.roleId,
      });
      const reply = await interaction.reply({
        content: ping.content,
        embeds: [made.embed],
        components: [row],
        allowedMentions: ping.allowedMentions,
        fetchReply: true,
      });
      const cards = require('../services/cards');
      const announced = await cards.publish(interaction.client, interaction.guildId, {
        kind: 'raffle',
        json: made.json,
        fields: [
          theme.prizeField(economy.prizeLine('raffle_win', loot)),
          theme.field('Ticket', ticketGp > 0 ? `${ticket} each` : 'Free', true),
          theme.field('Closes', theme.when(endsIso), true),
        ],
        mention: ping,
        sourceChannelId: reply.channelId,
        sourceMessageId: reply.id,
      });
      cards.flavorLater(reply, made.flavor, announced);
      await audit(interaction.client, interaction.guildId, `Raffle #${raffleId} **${title}** created by <@${interaction.user.id}>`);
      return;
    }

    if (sub === 'entries') {
      const id = interaction.options.getInteger('id');
      const raffle = await db.prepare('SELECT * FROM raffles WHERE id = ? AND guild_id = ?').get(id, interaction.guildId);

      if (!raffle) {
        return interaction.reply({ content: `❌ Raffle #${id} not found.`, flags: 64 });
      }

      const count = await db.prepare('SELECT COUNT(*) as count FROM raffle_entries WHERE raffle_id = ?').get(id);

      await interaction.reply({ content: `**${raffle.title}** has **${count.count}** entr${count.count === 1 ? 'y' : 'ies'}.${raffle.drawn ? ' (Already drawn)' : ''}`, flags: 64 });
      return;
    }

    if (sub === 'draw') {
      const id = interaction.options.getInteger('id');
      const raffle = await db.prepare('SELECT * FROM raffles WHERE id = ? AND guild_id = ?').get(id, interaction.guildId);

      if (!raffle) {
        return interaction.reply({ content: `❌ Raffle #${id} not found.`, flags: 64 });
      }

      if (raffle.drawn) {
        return interaction.reply({ content: `❌ Raffle #${id} has already been drawn. Winner: <@${raffle.winner_id}>`, flags: 64 });
      }

      const { buildConfirmationRow } = require('../services/confirmations');
      const row = buildConfirmationRow('raffle_draw', String(id), interaction.user.id);
      return interaction.reply({
        content: `⚠️ **Draw raffle #${id}: ${raffle.title}?** This picks a winner.`,
        components: [row],
        flags: 64,
      });
    }

    if (sub === 'end') {
      const id = interaction.options.getInteger('id');
      const raffle = await db.prepare('SELECT * FROM raffles WHERE id = ? AND guild_id = ?').get(id, interaction.guildId);

      if (!raffle) {
        return interaction.reply({ content: `❌ Raffle #${id} not found.`, flags: 64 });
      }

      if (raffle.drawn) {
        return interaction.reply({
          content: raffle.winner_id
            ? `Raffle #${id} already ended. Winner: <@${raffle.winner_id}>`
            : `Raffle #${id} is already closed.`,
          flags: 64,
        });
      }

      const { buildConfirmationRow } = require('../services/confirmations');
      const row = buildConfirmationRow('raffle_end', String(id), interaction.user.id);
      return interaction.reply({
        content: `⚠️ **Close raffle #${id}: ${raffle.title}?** No winner.`,
        components: [row],
        flags: 64,
      });
    }

    if (sub === 'list') {
      const data = await getPaginatedData('raffles', interaction.guildId, 0);
      if (!data || data.total === 0) {
        return interaction.reply({ content: 'No raffles yet. Create one with `/raffle create`!', flags: 64 });
      }
      await interaction.reply(buildPagePayload('raffles', data, 0, interaction.guildId));
      return;
    }

    if (sub === 'history') {
      const targetUser = interaction.options.getUser('user');

      if (targetUser) {
        const wins = await db.prepare(`
          SELECT * FROM raffles WHERE guild_id = ? AND winner_id = ? AND drawn = 1
          ORDER BY created_at DESC
        `).all(interaction.guildId, targetUser.id);

        const entries = await db.prepare(`
          SELECT COUNT(*) as count FROM raffle_entries re
          JOIN raffles r ON r.id = re.raffle_id
          WHERE r.guild_id = ? AND re.user_id = ?
        `).get(interaction.guildId, targetUser.id);

        const winRate = entries.count > 0
          ? ((wins.length / entries.count) * 100).toFixed(1)
          : '0.0';

        let response = `🎟️ **Raffle Stats for <@${targetUser.id}>**\n\n`;
        response += `🏆 Wins: **${wins.length}**\n`;
        response += `🎫 Entries: **${entries.count}**\n`;
        response += `📊 Win Rate: **${winRate}%**\n`;

        if (wins.length > 0) {
          response += `\n**Wins:**\n`;
          response += wins.map(w => `• **${w.title}** — <t:${Math.floor(new Date(w.created_at).getTime() / 1000)}:d>`).join('\n');
        }

        await interaction.reply({ content: response, flags: 64 });
      } else {
        const leaderboard = await db.prepare(`
          SELECT winner_id, COUNT(*) as wins
          FROM raffles
          WHERE guild_id = ? AND drawn = 1
          GROUP BY winner_id
          ORDER BY wins DESC
          LIMIT 20
        `).all(interaction.guildId);

        if (leaderboard.length === 0) {
          return interaction.reply({ content: 'No raffle winners yet. Draw some!', flags: 64 });
        }

        const medals = ['🥇', '🥈', '🥉'];
        const list = leaderboard.map((row, i) => {
          const medal = medals[i] || `${i + 1}.`;
          return `${medal} <@${row.winner_id}> — **${row.wins} win${row.wins === 1 ? '' : 's'}**`;
        }).join('\n');

        await interaction.reply({ content: `**Raffle Champions:**\n\n${list}`, flags: 64 });
      }
    }
  },
  staffSubs: ['create', 'draw', 'end'],
  publicSubs: ['create'],

  async autocomplete(interaction) {
    const { getDb } = require('../db/database');
    const { filterChoices, respond } = require('../services/autocomplete');
    const db = getDb();
    const sub = interaction.options.getSubcommand();
    const rows = (sub === 'draw' || sub === 'end')
      ? await db.prepare('SELECT id, title, drawn FROM raffles WHERE guild_id = ? AND drawn = 0 ORDER BY id DESC LIMIT 25').all(interaction.guildId)
      : await db.prepare('SELECT id, title, drawn FROM raffles WHERE guild_id = ? ORDER BY id DESC LIMIT 25').all(interaction.guildId);

    const focused = interaction.options.getFocused(true);
    await respond(interaction, filterChoices(rows, focused.value, r => ({
      name: `#${r.id} · ${r.title}${r.drawn ? ' (drawn)' : ''}`,
      value: r.id,
    })));
  },
};
