const { SlashCommandBuilder } = require('discord.js');
const { getDb } = require('../db/database');
const wom = require('../services/wom');
const { SKILL_CHOICES } = wom;
const { buildConfirmationRow } = require('../services/confirmations');
const sotwQueue = require('../services/sotwQueue');
const { isModerator } = require('../services/permissions');
const { audit } = require('../services/audit');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sotw')
    .setDescription('Skill of the Week — manage clan skill competitions via Wise Old Man')
    .addSubcommand(sub =>
      sub.setName('start')
        .setDescription('Start a new SOTW competition')
        .addStringOption(opt =>
          opt.setName('skill')
            .setDescription('Which skill to compete in')
            .setRequired(true)
            .addChoices(...SKILL_CHOICES))
        .addIntegerOption(opt =>
          opt.setName('duration_days')
            .setDescription('Duration in days (default: 7)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(30))
        .addStringOption(opt =>
          opt.setName('title')
            .setDescription('Custom competition title (default: SOTW: <skill>)')
            .setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('standings')
        .setDescription('Show current SOTW standings')
        .addIntegerOption(opt =>
          opt.setName('id')
            .setDescription('SOTW ID (defaults to current)')
            .setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('current')
        .setDescription('Show the current active SOTW'))
    .addSubcommand(sub =>
      sub.setName('end')
        .setDescription('End the current SOTW early and show results')
        .addIntegerOption(opt =>
          opt.setName('id')
            .setDescription('SOTW ID to end (defaults to current)')
            .setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('history')
        .setDescription('Show past SOTW winners'))
    .addSubcommand(sub =>
      sub.setName('champions')
        .setDescription('Show cumulative SOTW win leaderboard'))
    .addSubcommand(sub =>
      sub.setName('me')
        .setDescription('Show your personal progress in the current SOTW'))
    .addSubcommand(sub =>
      sub.setName('update')
        .setDescription('Refresh Wise Old Man hiscores for the current SOTW (does not start a new one)'))
    .addSubcommand(sub =>
      sub.setName('cancel')
        .setDescription('Abort the current SOTW and take it off Wise Old Man — no winner'))
    .addSubcommand(sub =>
      sub.setName('queue')
        .setDescription('Manage the SOTW queue')
        .addStringOption(opt =>
          opt.setName('action')
            .setDescription('Queue action')
            .setRequired(true)
            .addChoices(
              { name: 'Add skill to queue', value: 'add' },
              { name: 'List queue', value: 'list' },
              { name: 'Remove from queue', value: 'remove' },
              { name: 'Clear queue', value: 'clear' },
            ))
        .addStringOption(opt => opt.setName('skill').setDescription('Skill to queue (for add)').setRequired(false).addChoices(...SKILL_CHOICES))
        .addIntegerOption(opt => opt.setName('duration_days').setDescription('Duration in days (default: 7)').setRequired(false).setMinValue(1).setMaxValue(30))
        .addIntegerOption(opt => opt.setName('id').setDescription('Queue item ID (for remove)').setRequired(false))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const db = getDb();
    const settings = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(interaction.guildId);

    const modSubs = ['start', 'end', 'update', 'cancel'];
    if (modSubs.includes(sub) && !isModerator(interaction.member)) {
      return interaction.reply({ content: '❌ You need **Manage Events**, **Manage Server**, or **Administrator** permission to manage SOTW.', flags: 64 });
    }

    // ── Start ──────────────────────────────────
    if (sub === 'start') {
      const skill = interaction.options.getString('skill');
      const durationDays = interaction.options.getInteger('duration_days') || 7;
      const title = interaction.options.getString('title') || null;

      await interaction.deferReply();

      const { startSotw } = require('../services/sotw');
      const result = await startSotw({
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        createdBy: interaction.user.id,
        skill,
        durationDays,
        title,
      });

      if (!result.success) {
        return interaction.editReply(`❌ ${result.error}`);
      }

      await interaction.editReply(result.embed ? { embeds: [result.embed] } : result.response);
      await audit(interaction.client, interaction.guildId, `SOTW #${result.sotwId} **${skill}** started by <@${interaction.user.id}>`);
      return;
    }

    // ── Standings / Current ────────────────────
    if (sub === 'standings' || sub === 'current') {
      let sotw;
      if (sub === 'standings') {
        const id = interaction.options.getInteger('id');
        sotw = id
          ? db.prepare('SELECT * FROM sotw WHERE id = ? AND guild_id = ?').get(id, interaction.guildId)
          : db.prepare('SELECT * FROM sotw WHERE guild_id = ? AND ended = 0 ORDER BY id DESC').get(interaction.guildId);
      } else {
        sotw = db.prepare('SELECT * FROM sotw WHERE guild_id = ? AND ended = 0 ORDER BY id DESC').get(interaction.guildId);
      }

      if (!sotw) {
        return interaction.reply({ content: '❌ No active SOTW found. Start one with `/sotw start`.', flags: 64 });
      }

      await interaction.deferReply();

      if (!sotw.wom_competition_id) {
        return interaction.editReply('This SOTW is not linked to a WOM competition. Cannot fetch live standings.');
      }

      try {
        const details = await wom.getCompetitionDetails(sotw.wom_competition_id);
        const participations = (details.participations || [])
          .filter(p => p.progress && p.progress.gained > 0)
          .sort((a, b) => b.progress.gained - a.progress.gained);

        const theme = require('../services/theme');
        const endTs = Math.floor(new Date(sotw.ends_at).getTime() / 1000);
        const top = participations.slice(0, 10);
        const extra = participations.length > 10 ? `\n\n*+${participations.length - 10} more on WOM*` : '';

        const reply = await interaction.editReply({
          embeds: [theme.embed('sotw', {
            title: `${sotw.skill} SOTW`,
            description: participations.length === 0
              ? theme.line('sotwEmpty', sotw.id)
              : `${theme.rankLines(top, p => `**${p.player.displayName}** — ${p.progress.gained.toLocaleString()} XP`)}${extra}`,
            thumbnail: theme.skillIconUrl(sotw.skill),
            url: sotw.wom_competition_id
              ? `https://wiseoldman.net/competitions/${sotw.wom_competition_id}`
              : undefined,
            fields: [
              theme.field('Ends', `<t:${endTs}:R>`, true),
              theme.field('On the board', String(participations.length), true),
            ],
          })],
        });
        require('../services/live').pin(interaction.guildId, 'sotw', sotw.id, interaction.channelId, reply.id);
      } catch (err) {
        await interaction.editReply(`❌ Failed to fetch standings: ${err.message}`);
      }
      return;
    }

    // ── End ───────────────────────────────────
    if (sub === 'end') {
      const id = interaction.options.getInteger('id');
      const sotw = id
        ? db.prepare('SELECT * FROM sotw WHERE id = ? AND guild_id = ? AND ended = 0').get(id, interaction.guildId)
        : db.prepare('SELECT * FROM sotw WHERE guild_id = ? AND ended = 0 ORDER BY id DESC').get(interaction.guildId);

      if (!sotw) {
        return interaction.reply({ content: '❌ No active SOTW found to end.', flags: 64 });
      }

      // Confirmation flow
      const row = buildConfirmationRow('sotw_end', String(sotw.id), interaction.user.id);
      await interaction.reply({
        content: `⚠️ **End SOTW #${sotw.id}: ${sotw.skill.toUpperCase()}?**\nThis will finalize results and post them publicly. This cannot be undone.`,
        components: [row],
        flags: 64,
      });
      return;
    }

    // ── History ───────────────────────────────
    if (sub === 'history') {
      const winners = db.prepare('SELECT * FROM sotw_winners WHERE guild_id = ? ORDER BY id DESC LIMIT 20').all(interaction.guildId);

      if (winners.length === 0) {
        return interaction.reply('No SOTW history yet.');
      }

      const theme = require('../services/theme');
      const list = winners.map(w => {
        const date = new Date(w.ends_at).toLocaleDateString();
        return `${wom.getSkillEmoji(w.skill)} **${w.skill}** — **${w.winner_rsn}**${w.xp_gained ? ` · ${w.xp_gained.toLocaleString()} XP` : ''} · ${date}`;
      }).join('\n');

      await interaction.reply({
        embeds: [theme.embed('sotw', {
          title: 'SOTW history',
          description: list,
          thumbnail: theme.skillIconUrl(winners[0].skill),
        })],
      });
      return;
    }

    // ── Champions (cumulative win leaderboard) ──
    if (sub === 'champions') {
      const champions = db.prepare(`
        SELECT winner_rsn, COUNT(*) as wins, SUM(xp_gained) as total_xp
        FROM sotw_winners
        WHERE guild_id = ?
        GROUP BY winner_rsn
        ORDER BY wins DESC, total_xp DESC
        LIMIT 20
      `).all(interaction.guildId);

      if (champions.length === 0) {
        return interaction.reply('No SOTW champions yet. Start competing!');
      }

      const theme = require('../services/theme');
      await interaction.reply({
        embeds: [theme.embed('sotw', {
          title: 'SOTW champions',
          description: theme.rankLines(champions, c => `**${c.winner_rsn}** — ${c.wins} win${c.wins === 1 ? '' : 's'}${c.total_xp ? ` · ${c.total_xp.toLocaleString()} XP` : ''}`),
          thumbnail: theme.skillIconUrl('overall'),
        })],
      });
      return;
    }

    // ── Me (personal progress) ───────────────
    if (sub === 'me') {
      const member = db.prepare('SELECT * FROM members WHERE guild_id = ? AND user_id = ?').get(interaction.guildId, interaction.user.id);

      if (!member) {
        return interaction.reply({ content: '❌ You need to link your RSN first! Use `/member link rsn:<your_name>`.', flags: 64 });
      }

      const sotw = db.prepare('SELECT * FROM sotw WHERE guild_id = ? AND ended = 0 ORDER BY id DESC').get(interaction.guildId);

      if (!sotw) {
        return interaction.reply({ content: '❌ No active SOTW right now.', flags: 64 });
      }

      if (!sotw.wom_competition_id) {
        return interaction.reply({ content: '❌ This SOTW is not linked to a WOM competition.', flags: 64 });
      }

      await interaction.deferReply();

      try {
        const details = await wom.getCompetitionDetails(sotw.wom_competition_id);
        const participations = (details.participations || [])
          .filter(p => p.progress)
          .sort((a, b) => (b.progress.gained || 0) - (a.progress.gained || 0));

        // Find the user's entry by RSN
        const userRsnLower = member.rsn.toLowerCase();
        const userEntry = participations.find(p =>
          p.player.displayName.toLowerCase() === userRsnLower ||
          p.player.username.toLowerCase() === userRsnLower
        );

        if (!userEntry) {
          const endTs = Math.floor(new Date(sotw.ends_at).getTime() / 1000);
          return interaction.editReply(`📊 You're not in the current SOTW (${sotw.skill.toUpperCase()}). Make sure your RSN **${member.rsn}** is a member of the [WOM group](https://wiseoldman.net/competitions/${sotw.wom_competition_id}).\n\n⏰ Ends <t:${endTs}:R>`);
        }

        const rank = participations.indexOf(userEntry) + 1;
        const gained = userEntry.progress.gained || 0;
        const leader = participations[0];
        const behind = (leader.progress.gained || 0) - gained;
        const endTs = Math.floor(new Date(sotw.ends_at).getTime() / 1000);

        const theme = require('../services/theme');
        const pace = rank === 1
          ? 'You are in first.'
          : behind > 0
            ? `${behind.toLocaleString()} XP behind **${leader.player.displayName}**`
            : 'Keep grinding.';

        await interaction.editReply({
          embeds: [theme.embed('sotw', {
            title: `${member.rsn} · ${sotw.skill}`,
            description: pace,
            thumbnail: theme.skillIconUrl(sotw.skill),
            fields: [
              theme.field('Rank', `**#${rank}** / ${participations.length}`, true),
              theme.field('XP gained', `**${gained.toLocaleString()}**`, true),
              theme.field('Ends', `<t:${endTs}:R>`, true),
            ],
          })],
        });
      } catch (err) {
        await interaction.editReply(`❌ Failed to fetch your progress: ${err.message}`);
      }
      return;
    }

    if (sub === 'cancel') {
      const sotw = db.prepare('SELECT * FROM sotw WHERE guild_id = ? AND ended = 0 ORDER BY id DESC').get(interaction.guildId);
      if (!sotw) {
        return interaction.reply({ content: 'Nothing live to cancel.', flags: 64 });
      }
      if (sotw.wom_competition_id && settings?.wom_verif_code) {
        try {
          await wom.deleteCompetition(sotw.wom_competition_id, settings.wom_verif_code);
        } catch (err) {
          console.error('WOM delete on cancel:', err.message);
        }
      }
      db.prepare("UPDATE sotw SET ended = 1, winner_rsn = ? WHERE id = ?").run('Cancelled', sotw.id);
      db.prepare("UPDATE events SET reminder_sent = 1 WHERE guild_id = ? AND category = 'sotw' AND title LIKE ?").run(interaction.guildId, `%${sotw.skill}%`);
      await audit(interaction.client, interaction.guildId, `SOTW #${sotw.id} (${sotw.skill}) cancelled by <@${interaction.user.id}>`);
      return interaction.reply({ content: `SOTW **${sotw.skill}** is off. No winner. Wise Old Man competition removed if I had the code.` });
    }

    // ── Update ────────────────────────────────
    if (sub === 'update') {
      const sotw = db.prepare('SELECT * FROM sotw WHERE guild_id = ? AND ended = 0 ORDER BY id DESC').get(interaction.guildId);

      if (!sotw || !sotw.wom_competition_id) {
        return interaction.reply({ content: '❌ No active WOM-linked SOTW found.', flags: 64 });
      }

      if (!settings || !settings.wom_verif_code) {
        return interaction.reply({ content: '❌ No WOM verification code configured. Set WOM_VERIFICATION_CODE in .env.', flags: 64 });
      }

      await interaction.deferReply();

      try {
        await wom.updateOutdatedParticipants(sotw.wom_competition_id, settings.wom_verif_code);
        await interaction.editReply(`✅ Update queued on WOM. Standings will refresh shortly. Use \`/sotw standings\` to check.`);
      } catch (err) {
        await interaction.editReply(`❌ Failed to update: ${err.message}`);
      }
      return;
    }

    // ── Queue ────────────────────────────────
    if (sub === 'queue') {
      const action = interaction.options.getString('action');

      if (!isModerator(interaction.member) && action !== 'list') {
        return interaction.reply({ content: '❌ You need moderator permission to manage the SOTW queue.', flags: 64 });
      }

      if (action === 'add') {
        const skill = interaction.options.getString('skill');
        if (!skill) {
          return interaction.reply({ content: '❌ You need to specify a skill to queue.', flags: 64 });
        }
        const durationDays = interaction.options.getInteger('duration_days') || 7;
        const queueId = sotwQueue.addToQueue({
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          createdBy: interaction.user.id,
          skill,
          durationDays,
        });

        // Check if there's an active SOTW
        const active = db.prepare('SELECT * FROM sotw WHERE guild_id = ? AND ended = 0').get(interaction.guildId);
        if (active) {
          await interaction.reply(`📋 Added **${skill.toUpperCase()}** to the SOTW queue (ID: #${queueId}). It will auto-start when the current SOTW ends.`);
        } else {
          // No active SOTW — start immediately
          await interaction.deferReply();
          const result = await sotwQueue.startNextQueuedSotw(interaction.guildId, interaction.client);
          if (result?.success) {
            await interaction.editReply(`📋 Added and auto-started **${skill.toUpperCase()}** (no active SOTW was running).`);
          } else {
            await interaction.editReply(`📋 Added **${skill.toUpperCase()}** to the queue (ID: #${queueId}).`);
          }
        }
        return;
      }

      if (action === 'list') {
        const queue = sotwQueue.getQueue(interaction.guildId);
        if (queue.length === 0) {
          return interaction.reply('SOTW queue is empty. Add skills with `/sotw queue action:add skill:<skill>`.');
        }
        const list = queue.map((q, i) => `${i + 1}. ${wom.getSkillEmoji(q.skill)} **${q.skill.toUpperCase()}** — ${q.duration_days} days (ID: #${q.id})`).join('\n');
        await interaction.reply(`📋 **SOTW Queue:**\n\n${list}`);
        return;
      }

      if (action === 'remove') {
        const queueId = interaction.options.getInteger('id');
        if (!queueId) {
          return interaction.reply({ content: '❌ Specify a queue item ID to remove.', flags: 64 });
        }
        const removed = sotwQueue.removeFromQueue(queueId, interaction.guildId);
        if (removed) {
          await interaction.reply(`✅ Removed item #${queueId} from the SOTW queue.`);
        } else {
          await interaction.reply({ content: `❌ Queue item #${queueId} not found.`, flags: 64 });
        }
        return;
      }

      if (action === 'clear') {
        const count = sotwQueue.clearQueue(interaction.guildId);
        await interaction.reply(`✅ Cleared ${count} item${count === 1 ? '' : 's'} from the SOTW queue.`);
        return;
      }
    }
  },
  staffSubs: ['start', 'end', 'update', 'cancel'],
};
