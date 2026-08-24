const { SlashCommandBuilder } = require('discord.js');
const { getDb } = require('../db/database');
const wom = require('../services/wom');
const theme = require('../services/theme');
const { BOSS_CHOICES, BOSSES, prettyMetric } = require('../osrs/catalog');
const { isModerator } = require('../services/permissions');
const botw = require('../services/botw');

function resolveBoss(interaction) {
  return (interaction.options.getString('other') || interaction.options.getString('boss') || '').toLowerCase();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('boss')
    .setDescription('Boss of the Week KC — not a calendar mass')
    .addSubcommand(sub =>
      sub.setName('kc')
        .setDescription('Clan KC hiscores, or this BOTW window if a week is live')
        .addStringOption(opt => opt.setName('boss').setDescription('Boss').setRequired(true).addChoices(...BOSS_CHOICES))
        .addStringOption(opt => opt.setName('other').setDescription('Or type a boss metric, e.g. scurrius'))
        .addStringOption(opt => opt.setName('period').setDescription('Gains period').addChoices(
          { name: 'This BOTW (if live)', value: 'botw' },
          { name: 'Current KC', value: 'current' },
          { name: 'Day', value: 'day' },
          { name: 'Week', value: 'week' },
          { name: 'Month', value: 'month' },
        )))
    .addSubcommand(sub =>
      sub.setName('week')
        .setDescription('Start or show Boss of the Week (WOM KC, not /event)')
        .addStringOption(opt => opt.setName('boss').setDescription('Boss to start').addChoices(...BOSS_CHOICES))
        .addIntegerOption(opt => opt.setName('days').setDescription('How many days the hunt lasts').setMinValue(1).setMaxValue(30)))
    .addSubcommand(sub =>
      sub.setName('end')
        .setDescription('End the live hunt now and pay first place')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const db = getDb();
    const settings = await db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(interaction.guildId);

    if (sub === 'end') {
      if (!isModerator(interaction.member)) {
        return interaction.reply({ content: 'Mods end BOTW.', flags: 64 });
      }
      const current = await db.prepare('SELECT * FROM botw WHERE guild_id = ? AND ended = 0 ORDER BY id DESC').get(interaction.guildId);
      if (!current) return interaction.reply({ content: 'No BOTW running.', flags: 64 });
      await botw.finalizeBotw(interaction.client, current);
      return interaction.reply({ content: `BOTW **${prettyMetric(current.boss)}** closed. Results posted in the hunt channel.`, flags: 64 });
    }

    if (sub === 'week') {
      const boss = interaction.options.getString('boss');
      if (boss) {
        if (!isModerator(interaction.member)) {
          return interaction.reply({ content: 'Mods start BOTW.', flags: 64 });
        }
        const days = interaction.options.getInteger('days') || 7;
        const result = await botw.startBotw({
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          createdBy: interaction.user.id,
          boss,
          durationDays: days,
        });
        if (!result.success) {
          return interaction.reply({ content: result.error, flags: 64 });
        }
        const posted = await interaction.reply({ embeds: [result.embed], fetchReply: true });
        await require('../services/cards').publish(interaction.client, interaction.guildId, {
          kind: 'danger',
          json: result.card,
          sourceChannelId: posted.channelId,
          sourceMessageId: posted.id,
        });
        return;
      }
      const current = await db.prepare('SELECT * FROM botw WHERE guild_id = ? AND ended = 0 ORDER BY id DESC').get(interaction.guildId);
      if (!current) return interaction.reply({ content: 'No BOTW running. A mod can `/boss week boss:` after `/vote botw`, or start one here.', flags: 64 });
      const board = await botw.kcBoard(settings, current);
      return interaction.reply({
        flags: 64,
        embeds: [theme.embed('danger', {
          title: `BOTW · ${prettyMetric(current.boss)}`,
          description: [
            `Ends ${theme.when(current.ends_at)}`,
            board,
            'This is Wise Old Man KC for the hunt window — not a `/event` mass.',
          ].join('\n\n'),
          thumbnail: theme.skillIconUrl('slayer'),
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

    const current = await db.prepare('SELECT * FROM botw WHERE guild_id = ? AND ended = 0 ORDER BY id DESC').get(interaction.guildId);
    const period = interaction.options.getString('period') || 'current';
    await interaction.deferReply({ flags: 64 });
    try {
      if (period === 'botw') {
        if (!current || current.boss !== boss) {
          return interaction.editReply('No live BOTW for that boss. `/boss week` shows the hunt, or pick Day/Week/Month.');
        }
        const board = await botw.kcBoard(settings, current);
        return interaction.editReply({
          embeds: [theme.embed('danger', {
            title: `${prettyMetric(boss)} · this BOTW`,
            description: board,
            fields: [theme.field('Ends', theme.when(current.ends_at), true)],
          })],
        });
      }
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
  staffSubs: ['end'],
};
