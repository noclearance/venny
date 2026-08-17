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
    .setDescription('Manage clan raffles')
    .addSubcommand(sub =>
      sub.setName('create')
        .setDescription('Create a new raffle with a button for entries')
        .addStringOption(opt => opt.setName('title').setDescription('Raffle title').setRequired(true))
        .addStringOption(opt => opt.setName('description').setDescription('What are you raffling?').setRequired(false))
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
            )))
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
      const title = interaction.options.getString('title');
      const description = interaction.options.getString('description') || 'Click the button below to enter!';
      const weightMode = interaction.options.getString('weight_mode') || 'none';
      const ticketGp = interaction.options.getInteger('ticket_gp') ?? DEFAULT_TICKET_GP;

      const result = await db.prepare(`
        INSERT INTO raffles (guild_id, title, description, channel_id, created_by, weight_mode, ticket_gp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(interaction.guildId, title, description, interaction.channelId, interaction.user.id, weightMode, ticketGp);

      const raffleId = result.lastInsertRowid;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`raffle_enter_${raffleId}`)
          .setLabel('Enter Raffle')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🎟️')
      );

      const theme = require('../services/theme');
      const economy = require('../services/economy');
      const prize = description !== 'Click the button below to enter!' ? description : '';
      const card = await require('../services/flavor').write({
        job: 'raffle_start',
        facts: { title, prize: prize || null, weighted: weightMode !== 'none' },
        fallbackTitle: title,
        fallbackDescription: theme.line('raffleOpen', raffleId),
      });
      const ticket = ticketGp > 0 ? `${ticketGp.toLocaleString()} GP` : 'Free';
      const how = prize
        ? 'Pay staff in game, `/member link` your RSN, then tap **Enter Raffle**.'
        : ticketLine(ticketGp);
      const fields = [
        prize ? theme.field('Prize', prize) : null,
        theme.field('Ticket', ticket, true),
        theme.field('Odds', weightMode !== 'none' ? `Weighted by ${weightMode}` : 'Equal', true),
        theme.field('How to enter', how),
        theme.field('Guild credits', economy.payNote('raffle_enter', 'raffle_win')),
      ];
      const reply = await interaction.reply({
        embeds: [theme.embed('raffle', {
          title: card.title,
          description: card.description,
          fields,
          footer: `Raffle #${raffleId}  ·  Misclickers`,
          timestamp: true,
        })],
        components: [row],
        fetchReply: true,
      });
      await require('../services/announce').broadcast(interaction.client, interaction.guildId, {
        kind: 'raffle',
        title: card.title,
        description: card.description,
        fields: [
          prize ? theme.field('Prize', prize) : null,
          theme.field('Ticket', ticketGp > 0 ? `${ticket} each` : 'Free', true),
          theme.field('Guild credits', economy.payNote('raffle_enter', 'raffle_win')),
        ],
        sourceChannelId: reply.channelId,
        sourceMessageId: reply.id,
      });
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

      const entries = await db.prepare('SELECT * FROM raffle_entries WHERE raffle_id = ?').all(id);

      if (entries.length === 0) {
        return interaction.reply({ content: `❌ Raffle #${id} has no entries yet.`, flags: 64 });
      }

      let winner;
      let weightInfo = '';

      if (raffle.weight_mode && raffle.weight_mode !== 'none') {
        const weights = [];
        for (const entry of entries) {
          let weight = 1;
          let reason = 'base';

          if (raffle.weight_mode === 'sotw' || raffle.weight_mode === 'activity') {
            const sotwCount = await db.prepare(`
              SELECT COUNT(*) as count FROM sotw_winners
              WHERE guild_id = ? AND winner_rsn IN (
                SELECT rsn FROM members WHERE guild_id = ? AND user_id = ?
              )
            `).get(interaction.guildId, interaction.guildId, entry.user_id);
            const sotwWins = sotwCount?.count || 0;
            weight += Math.min(sotwWins, 5);
            if (sotwWins > 0) reason = `${sotwWins} SOTW wins`;
          }

          if (raffle.weight_mode === 'attendance' || raffle.weight_mode === 'activity') {
            const attendanceCount = await db.prepare(`
              SELECT COUNT(*) as count
              FROM event_attendance ea
              JOIN events e ON e.id = ea.event_id
              WHERE ea.user_id = ? AND ea.status = ? AND e.guild_id = ?
            `).get(entry.user_id, 'yes', interaction.guildId);
            const attParticipation = attendanceCount?.count || 0;
            weight += Math.min(attParticipation, 5);
            if (attParticipation > 0) reason += (reason !== 'base' ? ', ' : '') + `${attParticipation} events attended`;
          }

          weights.push({ ...entry, weight: Math.min(weight, 10), reason });
        }

        const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
        let random = Math.random() * totalWeight;
        for (const w of weights) {
          random -= w.weight;
          if (random <= 0) {
            winner = w;
            break;
          }
        }
        if (!winner) winner = weights[0];

        weightInfo = `\n📊 Weighted by **${raffle.weight_mode}** — winner had weight ${winner.weight} (${winner.reason}) out of ${totalWeight} total`;
      } else {
        winner = entries[Math.floor(Math.random() * entries.length)];
      }

      await db.prepare('UPDATE raffles SET drawn = 1, winner_id = ? WHERE id = ?').run(winner.user_id, id);
      await require('../services/economy').award(interaction.guildId, winner.user_id, 'raffle_win', interaction.client);

      const theme = require('../services/theme');
      const card = await require('../services/flavor').write({
        job: 'raffle_win',
        facts: { title: raffle.title, prize: raffle.description, entries: entries.length },
        fallbackTitle: `${raffle.title} — drawn`,
        fallbackDescription: theme.line('raffleWon', raffle.id),
      });
      const drawMsg = await interaction.reply({
        embeds: [theme.embed('raffle', {
          title: card.title,
          description: card.description,
          fields: [
            theme.field('Winner', `<@${winner.user_id}>`, true),
            theme.field('Entries', String(entries.length), true),
            raffle.description && raffle.description !== 'Click the button below to enter!'
              ? theme.field('Prize', raffle.description)
              : null,
            weightInfo.trim() ? theme.field('Odds', weightInfo.trim()) : null,
          ],
          footer: `Raffle #${id}  ·  Misclickers`,
          timestamp: true,
        })],
        fetchReply: true,
      });
      await require('../services/announce').broadcast(interaction.client, interaction.guildId, {
        kind: 'raffle',
        title: card.title,
        description: `${card.description}\n\n<@${winner.user_id}> takes it.`,
        fields: [theme.field('Guild credits', require('../services/economy').payNote('raffle_win'))],
        sourceChannelId: drawMsg.channelId,
        sourceMessageId: drawMsg.id,
        mention: `<@${winner.user_id}>`,
      });
      await audit(interaction.client, interaction.guildId, `Raffle #${id} **${raffle.title}** drawn by <@${interaction.user.id}> — winner <@${winner.user_id}>`);
      return;
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

      const count = await db.prepare('SELECT COUNT(*) as count FROM raffle_entries WHERE raffle_id = ?').get(id);
      await db.prepare('UPDATE raffles SET drawn = 1, winner_id = NULL WHERE id = ?').run(id);

      const theme = require('../services/theme');
      const closed = await interaction.reply({
        embeds: [theme.embed('raffle', {
          title: `${raffle.title} — closed`,
          description: 'No winner. The Enter button is dead.',
          fields: [
            theme.field('Entries', String(count?.count || 0), true),
            raffle.description && raffle.description !== 'Click the button below to enter!'
              ? theme.field('Prize', raffle.description)
              : null,
          ],
          footer: `Raffle #${id}  ·  Misclickers`,
          timestamp: true,
        })],
        fetchReply: true,
      });
      await require('../services/announce').broadcast(interaction.client, interaction.guildId, {
        kind: 'raffle',
        title: `${raffle.title} — closed`,
        description: 'Raffle ended with no draw.',
        sourceChannelId: closed.channelId,
        sourceMessageId: closed.id,
      });
      await audit(interaction.client, interaction.guildId, `Raffle #${id} **${raffle.title}** ended by <@${interaction.user.id}> (no winner)`);
      return;
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
  publicSubs: ['create', 'draw', 'end'],

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
