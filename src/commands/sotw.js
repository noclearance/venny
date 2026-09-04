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
    .setDescription('Wise Old Man Skill of the Week — not a calendar mass')
    .addSubcommand(sub => {
      sub.setName('start')
        .setDescription('Open a WOM week (attaches a live matching competition if one exists)')
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
            .setRequired(false))
        .addStringOption(opt =>
          opt.setName('prize')
            .setDescription('In-game loot for first place, e.g. bond or 50m')
            .setRequired(false)
            .setMaxLength(200));
      return require('../services/subscriptions').addPingOptions(sub);
    })
    .addSubcommand(sub =>
      sub.setName('standings')
        .setDescription('Show current SOTW standings')
        .addIntegerOption(opt =>
          opt.setName('id')
            .setDescription('SOTW ID (defaults to current)')
            .setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('current')
        .setDescription('Is this week on Discord only, or on Wise Old Man too?'))
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
      sub.setName('prize')
        .setDescription('Set the winning prize on the live week — does not restart')
        .addStringOption(opt =>
          opt.setName('prize')
            .setDescription('What first place wins, e.g. bond or 50m')
            .setRequired(true)
            .setMaxLength(200)))
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
    const settings = await db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(interaction.guildId);

    // ── Start ──────────────────────────────────
    if (sub === 'start') {
      const skill = interaction.options.getString('skill');
      const durationDays = interaction.options.getInteger('duration_days') || 7;
      const title = interaction.options.getString('title') || null;
      const prize = interaction.options.getString('prize') || null;
      const pingOpts = require('../services/subscriptions').pingFromInteraction(interaction);
      try {
        require('../services/subscriptions').assertCanPing(interaction.member, interaction.guild.members.me, pingOpts);
      } catch (err) {
        return require('../services/commandFail').commandFail(interaction, err);
      }

      await interaction.deferReply();

      const { startSotw } = require('../services/sotw');
      const result = await startSotw({
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        createdBy: interaction.user.id,
        skill,
        durationDays,
        title,
        prize,
      });

      if (!result.success) {
        return interaction.editReply(`❌ ${result.error}`);
      }

      const ping = await require('../services/subscriptions').mentionFor({
        guildId: interaction.guildId,
        category: 'sotw',
        mode: pingOpts.mode,
        roleId: pingOpts.roleId,
      });
      const posted = await interaction.editReply(result.embed
        ? { content: ping.content, embeds: [result.embed], allowedMentions: ping.allowedMentions }
        : result.response);
      const cards = require('../services/cards');
      const announced = await cards.publish(interaction.client, interaction.guildId, {
        kind: 'sotw',
        json: result.card,
        extraLines: [result.tracking],
        fields: result.flavor?.fields,
        sourceChannelId: posted.channelId,
        sourceMessageId: posted.id,
        mention: ping,
      });
      cards.flavorLater(posted, result.flavor, announced);
      await audit(interaction.client, interaction.guildId, `SOTW #${result.sotwId} **${skill}** started by <@${interaction.user.id}>`);
      return;
    }

    // ── Current ────────────────────────────────
    if (sub === 'current') {
      const sotw = await db.prepare('SELECT * FROM sotw WHERE guild_id = ? AND ended = 0 ORDER BY id DESC').get(interaction.guildId);
      if (!sotw) {
        return interaction.reply({ content: 'No SOTW running. A mod can `/sotw start`.', flags: 64 });
      }
      const theme = require('../services/theme');
      const economy = require('../services/economy');
      const status = require('../services/sotw').statusOf(sotw);
      const womLine = status === 'wom'
        ? `Tracked on [Wise Old Man](https://wiseoldman.net/competitions/${sotw.wom_competition_id}). \`/sotw standings\` for the board.`
        : 'This Discord week **is** live. Wise Old Man never got a competition (title too long, missing `/config`, or WOM 400). `/sotw update` tries to attach one.';
      return interaction.reply({
        embeds: [theme.embed('sotw', {
          title: `${sotw.skill} SOTW`,
          description: [theme.line('sotwOpen', sotw.id), theme.when(sotw.ends_at), womLine, `ID #${sotw.id}`].join('\n\n'),
          thumbnail: theme.skillIconUrl(sotw.skill),
          url: sotw.wom_competition_id ? `https://wiseoldman.net/competitions/${sotw.wom_competition_id}` : undefined,
          fields: [theme.prizeField(economy.prizeLine('sotw_win', sotw.prize))],
        })],
        flags: 64,
      });
    }

    // ── Standings ──────────────────────────────
    if (sub === 'standings') {
      const id = interaction.options.getInteger('id');
      const sotw = id
        ? await db.prepare('SELECT * FROM sotw WHERE id = ? AND guild_id = ?').get(id, interaction.guildId)
        : await db.prepare('SELECT * FROM sotw WHERE guild_id = ? AND ended = 0 ORDER BY id DESC').get(interaction.guildId);

      if (!sotw) {
        return interaction.reply({ content: '❌ No active SOTW found. Start one with `/sotw start`.', flags: 64 });
      }

      await interaction.deferReply({ flags: 64 });

      if (!sotw.wom_competition_id) {
        return interaction.editReply(
          `**${sotw.skill}** SOTW #${sotw.id} is running in Discord until ${require('../services/theme').when(sotw.ends_at)}.\n\nWise Old Man never got a competition for this week, so I cannot fetch XP. A mod can \`/sotw update\` to attach WOM, or \`/sotw cancel\` and start again.`
        );
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
        const board = participations.length === 0
          ? theme.line('sotwEmpty', sotw.id)
          : `${theme.rankLines(top, p => `**${p.player.displayName}** — ${p.progress.gained.toLocaleString()} XP`)}${extra}`;
        const made = await require('../services/cards').make('sotw', {
          job: 'sotw_standings',
          facts: { skill: sotw.skill, onBoard: participations.length },
          fallbackTitle: `${sotw.skill} SOTW`,
          extraLines: participations.length === 0 ? [] : [board],
          fallbackDescription: participations.length === 0 ? board : '',
          thumbnail: theme.skillIconUrl(sotw.skill),
          url: sotw.wom_competition_id
            ? `https://wiseoldman.net/competitions/${sotw.wom_competition_id}`
            : undefined,
          fields: [
            theme.field('Ends', `<t:${endTs}:R>`, true),
            theme.field('On the board', String(participations.length), true),
          ],
        });

        const reply = await interaction.editReply({
          embeds: [made.embed],
        });
        await require('../services/live').pin(interaction.guildId, 'sotw', sotw.id, interaction.channelId, reply.id);
      } catch (err) {
        await interaction.editReply(`❌ Failed to fetch standings: ${err.message}`);
      }
      return;
    }

    // ── Prize (live week) ─────────────────────
    if (sub === 'prize') {
      const sotw = await db.prepare('SELECT * FROM sotw WHERE guild_id = ? AND ended = 0 ORDER BY id DESC').get(interaction.guildId);
      if (!sotw) {
        return require('../services/commandFail').commandFail(interaction, 'No SOTW is live. Do not start a new one just to add a prize — `/sotw start` when the next week begins.');
      }
      const economy = require('../services/economy');
      const loot = economy.clipPrize(interaction.options.getString('prize'));
      if (!loot) {
        return require('../services/commandFail').commandFail(interaction, 'Tell me the actual loot (bond, 50m). I will not invent it.');
      }
      await db.prepare('UPDATE sotw SET prize = ? WHERE id = ?').run(loot, sotw.id);
      const theme = require('../services/theme');
      const line = economy.prizeLine('sotw_win', loot);
      await interaction.reply({
        embeds: [theme.embed('sotw', {
          title: `${sotw.skill} SOTW — prize`,
          description: 'This week is still live. First place when it ends. XP on Wise Old Man is unchanged.',
          thumbnail: theme.skillIconUrl(sotw.skill),
          fields: [theme.prizeField(line)],
        })],
      });
      await audit(interaction.client, interaction.guildId, `SOTW #${sotw.id} **${sotw.skill}** prize set to **${loot}** by <@${interaction.user.id}>`);
      return;
    }

    // ── End ───────────────────────────────────
    if (sub === 'end') {
      const id = interaction.options.getInteger('id');
      const sotw = id
        ? await db.prepare('SELECT * FROM sotw WHERE id = ? AND guild_id = ? AND ended = 0').get(id, interaction.guildId)
        : await db.prepare('SELECT * FROM sotw WHERE guild_id = ? AND ended = 0 ORDER BY id DESC').get(interaction.guildId);

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
      const winners = await db.prepare('SELECT * FROM sotw_winners WHERE guild_id = ? ORDER BY id DESC LIMIT 20').all(interaction.guildId);

      if (winners.length === 0) {
        return interaction.reply({ content: 'No SOTW history yet.', flags: 64 });
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
        flags: 64,
      });
      return;
    }

    // ── Champions (cumulative win leaderboard) ──
    if (sub === 'champions') {
      const champions = await db.prepare(`
        SELECT winner_rsn, COUNT(*) as wins, SUM(xp_gained) as total_xp
        FROM sotw_winners
        WHERE guild_id = ?
        GROUP BY winner_rsn
        ORDER BY wins DESC, total_xp DESC
        LIMIT 20
      `).all(interaction.guildId);

      if (champions.length === 0) {
        return interaction.reply({ content: 'No SOTW champions yet. Start competing!', flags: 64 });
      }

      const theme = require('../services/theme');
      await interaction.reply({
        embeds: [theme.embed('sotw', {
          title: 'SOTW champions',
          description: theme.rankLines(champions, c => `**${c.winner_rsn}** — ${c.wins} win${c.wins === 1 ? '' : 's'}${c.total_xp ? ` · ${c.total_xp.toLocaleString()} XP` : ''}`),
          thumbnail: theme.skillIconUrl('overall'),
        })],
        flags: 64,
      });
      return;
    }

    // ── Me (personal progress) ───────────────
    if (sub === 'me') {
      const member = await db.prepare('SELECT * FROM members WHERE guild_id = ? AND user_id = ?').get(interaction.guildId, interaction.user.id);

      if (!member) {
        return interaction.reply({ content: '❌ You need to link your RSN first! Use `/me link rsn:<your_name>`.', flags: 64 });
      }

      const sotw = await db.prepare('SELECT * FROM sotw WHERE guild_id = ? AND ended = 0 ORDER BY id DESC').get(interaction.guildId);

      if (!sotw) {
        return interaction.reply({ content: '❌ No active SOTW right now.', flags: 64 });
      }

      if (!sotw.wom_competition_id) {
        return interaction.reply({
          content: `**${sotw.skill}** is the live Discord SOTW, but it was never created on Wise Old Man — I have no XP to show. A mod can \`/sotw update\`.`,
          flags: 64,
        });
      }

      await interaction.deferReply({ flags: 64 });

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
      const sotw = await db.prepare('SELECT * FROM sotw WHERE guild_id = ? AND ended = 0 ORDER BY id DESC').get(interaction.guildId);
      if (!sotw) {
        return interaction.reply({ content: 'Nothing live to cancel.', flags: 64 });
      }
      const row = buildConfirmationRow('sotw_cancel', String(sotw.id), interaction.user.id);
      return interaction.reply({
        content: `⚠️ **Cancel SOTW #${sotw.id}: ${sotw.skill.toUpperCase()}?**\nNo winner. I will delete the WOM competition if I have the code.`,
        components: [row],
        flags: 64,
      });
    }

    // ── Update ────────────────────────────────
    if (sub === 'update') {
      let sotw = await db.prepare('SELECT * FROM sotw WHERE guild_id = ? AND ended = 0 ORDER BY id DESC').get(interaction.guildId);
      const sotwSvc = require('../services/sotw');

      if (!sotw) {
        await interaction.deferReply({ flags: 64 });
        const adopted = await sotwSvc.adoptLiveFromWom({
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          createdBy: interaction.user.id,
        });
        if (!adopted.success) {
          return interaction.editReply(adopted.error);
        }
        return interaction.editReply(
          `Found the live WOM week **${adopted.sotw.skill}**: https://wiseoldman.net/competitions/${adopted.sotw.wom_competition_id}\nThe mass on the calendar is separate. First place still gets guild credits when this WOM week ends. \`/sotw standings\``
        );
      }

      if (!sotw.wom_competition_id) {
        await interaction.deferReply({ flags: 64 });
        const linked = await sotwSvc.ensureWomWeek(sotw);
        if (!linked.sotw?.wom_competition_id) {
          return interaction.editReply(`Could not attach WOM: ${linked.error || 'unknown'}`);
        }
        const how = linked.adopted ? 'Attached the live WOM week' : 'Created a WOM competition';
        return interaction.editReply(`${how}: https://wiseoldman.net/competitions/${linked.sotw.wom_competition_id}\nYour mass event is unchanged. First place still gets **${require('../services/economy').coins('sotw_win')}** guild credits when the week ends.`);
      }

      if (!settings || !settings.wom_verif_code) {
        return interaction.reply({ content: '❌ No WOM verification code configured. Set it with `/config wom-verification`.', flags: 64 });
      }

      await interaction.deferReply({ flags: 64 });

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
        const queueId = await sotwQueue.addToQueue({
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          createdBy: interaction.user.id,
          skill,
          durationDays,
        });

        // Check if there's an active SOTW
        const active = await db.prepare('SELECT * FROM sotw WHERE guild_id = ? AND ended = 0').get(interaction.guildId);
        if (active) {
          await interaction.reply({ content: `Added **${skill.toUpperCase()}** to the SOTW queue (ID: #${queueId}). It will auto-start when the current SOTW ends.`, flags: 64 });
        } else {
          // No active SOTW — start immediately
          await interaction.deferReply({ flags: 64 });
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
        const queue = await sotwQueue.getQueue(interaction.guildId);
        if (queue.length === 0) {
          return interaction.reply({ content: 'SOTW queue is empty. Add skills with `/sotw queue action:add skill:<skill>`.', flags: 64 });
        }
        const list = queue.map((q, i) => `${i + 1}. ${wom.getSkillEmoji(q.skill)} **${q.skill.toUpperCase()}** — ${q.duration_days} days (ID: #${q.id})`).join('\n');
        await interaction.reply({ content: `**SOTW Queue:**\n\n${list}`, flags: 64 });
        return;
      }

      if (action === 'remove') {
        const queueId = interaction.options.getInteger('id');
        if (!queueId) {
          return interaction.reply({ content: '❌ Specify a queue item ID to remove.', flags: 64 });
        }
        const removed = await sotwQueue.removeFromQueue(queueId, interaction.guildId);
        if (removed) {
          await interaction.reply({ content: `Removed item #${queueId} from the SOTW queue.`, flags: 64 });
        } else {
          await interaction.reply({ content: `❌ Queue item #${queueId} not found.`, flags: 64 });
        }
        return;
      }

      if (action === 'clear') {
        const row = buildConfirmationRow('sotw_queue_clear', 'all', interaction.user.id);
        await interaction.reply({
          content: '⚠️ **Clear the SOTW queue?** This drops every queued skill.',
          components: [row],
          flags: 64,
        });
        return;
      }
    }
  },
  staffSubs: ['start', 'end', 'update', 'cancel', 'prize', 'queue'],
  publicSubs: ['start', 'prize'],
};
