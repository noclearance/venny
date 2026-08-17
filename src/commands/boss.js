const { SlashCommandBuilder } = require('discord.js');
const { getDb } = require('../db/database');
const wom = require('../services/wom');
const theme = require('../services/theme');
const { BOSS_CHOICES, BOSSES, prettyMetric } = require('../osrs/catalog');
const { isModerator } = require('../services/permissions');

function resolveBoss(interaction) {
  return (interaction.options.getString('other') || interaction.options.getString('boss') || '').toLowerCase();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('boss')
    .setDescription('Boss KC boards and Boss of the Week')
    .addSubcommand(sub =>
      sub.setName('kc')
        .setDescription('Clan KC hiscores or gained')
        .addStringOption(opt => opt.setName('boss').setDescription('Boss').setRequired(true).addChoices(...BOSS_CHOICES))
        .addStringOption(opt => opt.setName('other').setDescription('Or type a boss metric, e.g. scurrius'))
        .addStringOption(opt => opt.setName('period').setDescription('Gains period').addChoices(
          { name: 'Current KC', value: 'current' },
          { name: 'Day', value: 'day' },
          { name: 'Week', value: 'week' },
          { name: 'Month', value: 'month' },
        )))
    .addSubcommand(sub =>
      sub.setName('week')
        .setDescription('Start or show Boss of the Week')
        .addStringOption(opt => opt.setName('boss').setDescription('Boss to start').addChoices(...BOSS_CHOICES))
        .addIntegerOption(opt => opt.setName('days').setDescription('Length').setMinValue(1).setMaxValue(30))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const db = getDb();
    const settings = await db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(interaction.guildId);

    if (sub === 'week') {
      const boss = interaction.options.getString('boss');
      if (boss) {
        if (!isModerator(interaction.member)) {
          return interaction.reply({ content: 'Mods start BOTW.', flags: 64 });
        }
        const days = interaction.options.getInteger('days') || 7;
        await db.prepare('UPDATE botw SET ended = 1 WHERE guild_id = ? AND ended = 0').run(interaction.guildId);
        const ends = new Date(Date.now() + days * 86400000).toISOString();
        await db.prepare(`
          INSERT INTO botw (guild_id, boss, starts_at, ends_at, channel_id, created_by)
          VALUES (?, ?, datetime('now'), ?, ?, ?)
        `).run(interaction.guildId, boss, ends, interaction.channelId, interaction.user.id);
        return interaction.reply({
          embeds: [theme.embed('danger', {
            title: `Boss of the Week · ${prettyMetric(boss)}`,
            description: [
              `KC from this second until ${theme.when(ends)} counts.`,
              `Check the board with \`/boss kc boss:${prettyMetric(boss)} period:Week\`.`,
              'Linked RSN first or you are not on it.',
            ].join('\n\n'),
            thumbnail: theme.skillIconUrl('slayer'),
            fields: [
              theme.field('Boss', prettyMetric(boss), true),
              theme.field('Ends', theme.when(ends), true),
            ],
          })],
        });
      }
      const current = await db.prepare('SELECT * FROM botw WHERE guild_id = ? AND ended = 0 ORDER BY id DESC').get(interaction.guildId);
      if (!current) return interaction.reply({ content: 'No BOTW running. A mod can `/boss week boss:`.', flags: 64 });
      return interaction.reply({
        flags: 64,
        embeds: [theme.embed('danger', {
          title: `BOTW · ${prettyMetric(current.boss)}`,
          description: `Ends ${theme.when(current.ends_at)}`,
        })],
      });
    }

    const boss = resolveBoss(interaction);
    if (!BOSSES.includes(boss)) {
      return interaction.reply({ content: `Unknown boss \`${boss}\`.`, flags: 64 });
    }
    if (!settings?.wom_group_id) {
      return interaction.reply({ content: 'Set a WOM group first.', flags: 64 });
    }

    const period = interaction.options.getString('period') || 'current';
    await interaction.deferReply({ flags: 64 });
    try {
      if (period === 'current') {
        const hiscores = await wom.getGroupHiscores(settings.wom_group_id, boss, 15);
        const lines = (hiscores || [])
          .filter(row => (row.data?.kills || 0) > 0)
          .map((row, i) => `${theme.medal(i)} **${row.player.displayName}** — ${row.data.kills.toLocaleString()} KC`);
        return interaction.editReply({
          embeds: [theme.embed('danger', {
            title: `${prettyMetric(boss)} KC`,
            description: lines.join('\n') || 'Nobody ranked.',
          })],
        });
      }
      const gained = await wom.getGroupGained(settings.wom_group_id, boss, period, 15);
      const lines = (gained || [])
        .map(row => {
          const n = row.data?.gained ?? row.data?.kills?.gained ?? row.data?.kills ?? 0;
          return { name: row.player?.displayName, gained: Number(n) || 0 };
        })
        .filter(row => row.gained > 0)
        .slice(0, 10)
        .map((row, i) => `${theme.medal(i)} **${row.name}** — +${row.gained.toLocaleString()} KC`);
      return interaction.editReply({
        embeds: [theme.embed('danger', {
          title: `${prettyMetric(boss)} gained · ${period}`,
          description: lines.join('\n') || 'No KC this period.',
        })],
      });
    } catch (err) {
      return interaction.editReply(`WOM said no: ${err.message}`);
    }
  },
  publicSubs: ['week'],
};
