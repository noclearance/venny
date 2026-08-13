const { SlashCommandBuilder } = require('discord.js');
const { getDb } = require('../db/database');
const wom = require('../services/wom');
const { SKILL_CHOICES } = wom;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View clan leaderboards via Wise Old Man')
    .addSubcommand(sub =>
      sub.setName('hiscores')
        .setDescription('Top clan members by current XP/level in a skill')
        .addStringOption(opt =>
          opt.setName('skill')
            .setDescription('Skill to show')
            .setRequired(true)
            .addChoices(...SKILL_CHOICES))
        .addIntegerOption(opt => opt.setName('limit').setDescription('Number of results (default: 10, max: 50)').setRequired(false).setMinValue(1).setMaxValue(50)))
    .addSubcommand(sub =>
      sub.setName('gained')
        .setDescription('Top clan members by XP gained over a time period')
        .addStringOption(opt =>
          opt.setName('skill')
            .setDescription('Skill to show')
            .setRequired(true)
            .addChoices(...SKILL_CHOICES))
        .addStringOption(opt =>
          opt.setName('period')
            .setDescription('Time period')
            .setRequired(false)
            .addChoices(
              { name: 'Day', value: 'day' },
              { name: 'Week', value: 'week' },
              { name: 'Month', value: 'month' },
              { name: 'Year', value: 'year' },
            )))
    .addSubcommand(sub =>
      sub.setName('player')
        .setDescription('Look up a player\'s stats')
        .addStringOption(opt => opt.setName('rsn').setDescription('RSN to look up').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const db = getDb();
    const settings = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(interaction.guildId);

    // ── Hiscores ──────────────────────────────
    if (sub === 'hiscores') {
      const skill = interaction.options.getString('skill');
      const limit = interaction.options.getInteger('limit') || 10;

      if (!settings || !settings.wom_group_id) {
        return interaction.reply({ content: '❌ No WOM group ID configured. Set `WOM_GROUP_ID` in `.env` or use `/config`.', flags: 64 });
      }

      await interaction.deferReply();

      try {
        const hiscores = await wom.getGroupHiscores(settings.wom_group_id, skill, limit);

        if (!hiscores || hiscores.length === 0) {
          return interaction.editReply(`No hiscores data for ${skill}.`);
        }

        const theme = require('../services/theme');
        await interaction.editReply({
          embeds: [theme.embed('info', {
            title: `${wom.getSkillEmoji(skill)}  Clan hiscores · ${skill}`,
            description: theme.rankLines(hiscores, entry => `**${entry.player.displayName}** — ${entry.data.experience.toLocaleString()} XP · lvl ${entry.data.level}`),
            thumbnail: theme.skillIconUrl(skill),
          })],
        });
      } catch (err) {
        await interaction.editReply(`❌ Failed to fetch hiscores: ${err.message}`);
      }
      return;
    }

    // ── Gained ────────────────────────────────
    if (sub === 'gained') {
      const skill = interaction.options.getString('skill');
      const period = interaction.options.getString('period') || 'week';

      if (!settings || !settings.wom_group_id) {
        return interaction.reply({ content: '❌ No WOM group ID configured. Set `WOM_GROUP_ID` in `.env` or use `/config`.', flags: 64 });
      }

      await interaction.deferReply();

      try {
        const gained = await wom.getGroupGained(settings.wom_group_id, skill, period, 50);

        if (!gained || gained.length === 0) {
          return interaction.editReply(`No gains data for ${skill} this ${period}.`);
        }

        const top = gained.slice(0, 10);
        const theme = require('../services/theme');
        await interaction.editReply({
          embeds: [theme.embed('sotw', {
            title: `${wom.getSkillEmoji(skill)}  XP gained · ${skill}`,
            description: theme.rankLines(top, entry => `**${entry.player.displayName}** — +${entry.data.gained.toLocaleString()} XP`),
            thumbnail: theme.skillIconUrl(skill),
            fields: [theme.field('Period', period, true)],
          })],
        });
      } catch (err) {
        await interaction.editReply(`❌ Failed to fetch gains: ${err.message}`);
      }
      return;
    }

    // ── Player lookup ────────────────────────
    if (sub === 'player') {
      const rsn = interaction.options.getString('rsn').trim();

      await interaction.deferReply();

      try {
        const details = await wom.getPlayerDetails(rsn);
        const snap = details.latestSnapshot;

        if (!snap) {
          return interaction.editReply(`Found **${details.displayName}** but no snapshot data available.`);
        }

        const skills = snap.data.skills || {};
        const overall = skills.overall || {};

        const theme = require('../services/theme');
        const embed = theme.embed('info', {
          title: `📊 ${details.displayName}`,
          url: `https://wiseoldman.net/players/${encodeURIComponent(details.username)}`,
          thumbnail: theme.skillIconUrl('overall'),
          fields: [
            theme.field('Combat', `${details.combatLevel || '—'}`, true),
            theme.field('Total XP', `${(overall.experience || 0).toLocaleString()}`, true),
            theme.field('EHP', `${(details.ehp || 0).toFixed(1)}`, true),
            theme.field('Total level', `${overall.level || '—'}`, true),
            theme.field('Rank', `#${(overall.rank || 0).toLocaleString()}`, true),
            theme.field('Type', `${details.type || '—'}`, true),
          ],
        });

        // Show top 6 skills by XP
        const skillEntries = Object.entries(skills)
          .filter(([k]) => k !== 'overall')
          .sort((a, b) => (b[1].experience || 0) - (a[1].experience || 0))
          .slice(0, 6);

        if (skillEntries.length > 0) {
          const skillList = skillEntries.map(([name, data]) => {
            return `${wom.getSkillEmoji(name)} ${name.charAt(0).toUpperCase() + name.slice(1)}: **${data.level || 0}** (${(data.experience || 0).toLocaleString()} XP)`;
          }).join('\n');
          embed.addFields({ name: 'Top Skills', value: skillList });
        }

        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        await interaction.editReply(`❌ Could not find player "${rsn}": ${err.message}`);
      }
      return;
    }
  },
};
