const { SlashCommandBuilder } = require('discord.js');
const { getDb } = require('../db/database');
const wom = require('../services/wom');
const sotwQueue = require('../services/sotwQueue');
const { isAdmin } = require('../services/permissions');
const { audit } = require('../services/audit');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clan')
    .setDescription('Clan dashboard and info')
    .addSubcommand(sub =>
      sub.setName('info')
      .setDescription('Show a dashboard of active SOTW, events, raffles, polls, and member count'))
    .addSubcommand(sub =>
      sub.setName('sync')
        .setDescription('Sync clan members from Wise Old Man (admin only)')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const db = getDb();

    if (sub === 'info') {
      await interaction.deferReply({ flags: 64 });

      const settings = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(interaction.guildId);
      const now = new Date().toISOString();

      // Gather stats
      const memberCount = db.prepare('SELECT COUNT(*) as count FROM members WHERE guild_id = ?').get(interaction.guildId).count;
      const activeSotw = db.prepare('SELECT * FROM sotw WHERE guild_id = ? AND ended = 0 ORDER BY id DESC').get(interaction.guildId);
      const upcomingEvents = db.prepare('SELECT * FROM events WHERE guild_id = ? AND event_time > ? ORDER BY event_time ASC LIMIT 5').all(interaction.guildId, now);
      const activeRaffles = db.prepare('SELECT * FROM raffles WHERE guild_id = ? AND drawn = 0 ORDER BY id DESC').all(interaction.guildId);
      const activePolls = db.prepare('SELECT * FROM polls WHERE guild_id = ? AND finalized = 0 ORDER BY id DESC').all(interaction.guildId);
      const sotwWinCount = db.prepare('SELECT COUNT(*) as count FROM sotw_winners WHERE guild_id = ?').get(interaction.guildId).count;

      const theme = require('../services/theme');

      let sotwValue = theme.EMPTY.sotw;
      if (activeSotw) {
        const endTs = Math.floor(new Date(activeSotw.ends_at).getTime() / 1000);
        sotwValue = `${wom.getSkillEmoji(activeSotw.skill)} **${activeSotw.skill.toUpperCase()}**\nEnds <t:${endTs}:R>`;
        if (activeSotw.wom_competition_id) {
          sotwValue += `\n[Open on WOM](https://wiseoldman.net/competitions/${activeSotw.wom_competition_id})`;
        }
      }

      const eventValue = upcomingEvents.length
        ? upcomingEvents.map(e => {
          const ts = Math.floor(new Date(e.event_time).getTime() / 1000);
          return `${theme.categoryIcon(e.category)} **${e.title}**\n<t:${ts}:R>`;
        }).join('\n')
        : theme.EMPTY.events;

      const raffleValue = activeRaffles.length
        ? activeRaffles.map(r => `🎟️ **${r.title}** · #${r.id}`).join('\n')
        : theme.EMPTY.raffles;

      const pollValue = activePolls.length
        ? activePolls.map(p => {
          const typeLabel = p.type === 'sotw' ? '🏆' : p.type === 'botw' ? '🐉' : '🗳️';
          return `${typeLabel} **${p.question}** · #${p.id}`;
        }).join('\n')
        : theme.EMPTY.polls;

      const queue = sotwQueue.getQueue(interaction.guildId);
      const fields = [
        theme.field('🏆 Skill of the Week', sotwValue, true),
        theme.field(`📅 Events · ${upcomingEvents.length}`, eventValue, true),
        theme.field(`🎟️ Raffles · ${activeRaffles.length}`, raffleValue, true),
        theme.field(`🗳️ Polls · ${activePolls.length}`, pollValue, true),
        theme.field('👥 Linked', `**${memberCount}** members`, true),
        theme.field('🏅 SOTWs done', `**${sotwWinCount}**`, true),
      ];

      if (settings && settings.wom_group_id) {
        fields.push(theme.field('📊 Wise Old Man', `[Clan group #${settings.wom_group_id}](https://wiseoldman.net/groups/${settings.wom_group_id})`, true));
      }
      if (queue.length > 0) {
        fields.push(theme.field(`📋 SOTW queue · ${queue.length}`, queue.map((q, i) => `${i + 1}. ${wom.getSkillEmoji(q.skill)} **${q.skill}**`).join('\n')));
      }
      const bingoCard = require('../services/bingo').activeBingo(interaction.guildId);
      if (bingoCard) {
        fields.push(theme.field('Bingo', `**${bingoCard.title}** · ${bingoCard.status} · \`/bingo board\``));
      }
      const busy = Boolean(activeSotw || upcomingEvents.length || activeRaffles.length || bingoCard);
      const embed = theme.embed('brand', {
        title: 'Clan dashboard',
        description: theme.line(busy ? 'dashboardBusy' : 'dashboardQuiet', `${memberCount}-${sotwWinCount}`),
        thumbnail: activeSotw ? theme.skillIconUrl(activeSotw.skill) : theme.VENNY.icon,
        fields,
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // ── Sync ─────────────────────────────────
    if (sub === 'sync') {
      if (!isAdmin(interaction.member)) {
        return interaction.reply({ content: '❌ You need Administrator permission to sync the clan.', flags: 64 });
      }

      const settings = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(interaction.guildId);
      if (!settings || !settings.wom_group_id) {
        return interaction.reply({ content: '❌ No WOM group ID configured. Set it with `/config wom-group`.', flags: 64 });
      }

      await interaction.deferReply({ flags: 64 });

      try {
        // Fetch group hiscores to get member list
        const hiscores = await wom.getGroupHiscores(settings.wom_group_id, 'overall', 500);

        let synced = 0;
        let linked = 0;
        const unlinked = [];
        const now = new Date().toISOString();

        for (const entry of hiscores) {
          const rsn = entry.player.username;
          const womId = entry.player.id;

          // Upsert into clan_players
          db.prepare(`
            INSERT INTO clan_players (guild_id, rsn, wom_id, last_synced_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(guild_id, rsn) DO UPDATE SET wom_id = ?, last_synced_at = ?
          `).run(interaction.guildId, rsn, womId, now, womId, now);
          synced++;

          // Check if linked to Discord
          const member = db.prepare('SELECT * FROM members WHERE guild_id = ? AND rsn = ?').get(interaction.guildId, rsn);
          if (member) {
            linked++;
          } else {
            unlinked.push(rsn);
          }
        }

        let response = `🔄 **Clan Sync Complete**\n\n`;
        response += `👥 Synced: **${synced}** members from WOM\n`;
        response += `✅ Discord-linked: **${linked}**\n`;
        response += `❌ Unlinked: **${unlinked.length}**\n\n`;

        if (unlinked.length > 0) {
          response += `Unlinked RSNs (ask them to run \`/member link\`):\n`;
          response += unlinked.slice(0, 20).map(r => `• ${r}`).join('\n');
          if (unlinked.length > 20) {
            response += `\n*...and ${unlinked.length - 20} more*`;
          }
        }

        await interaction.editReply(response);
        await audit(interaction.client, interaction.guildId, `Clan sync: ${synced} WOM members, ${linked} linked, by <@${interaction.user.id}>`);
      } catch (err) {
        await interaction.editReply(`❌ Sync failed: ${err.message}`);
      }
      return;
    }
  },
  adminSubs: ['sync'],
};
