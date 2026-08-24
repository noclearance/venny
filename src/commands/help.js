const { SlashCommandBuilder } = require('discord.js');
const theme = require('../services/theme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('What each command is for'),

  async execute(interaction) {
    const embed = theme.embed('info', {
      title: 'Venny — command book',
      description: 'SOTW is a Wise Old Man week. Events are masses on the calendar. They are not the same.',
      fields: [
        theme.field('Skill of the Week (WOM)', [
          '`/sotw start` — open a WOM competition',
          '`/sotw current` — Discord week vs WOM',
          '`/sotw standings` `/me` — XP board',
          '`/sotw update` — attach or refresh WOM',
          '`/vote sotw` — poll the next skill, then it can auto-start',
        ].join('\n')),
        theme.field('Masses (calendar)', [
          '`/event create` — ToB, hangout, RSVP, 15-min ping',
          '`/event list` `/remind` `/cancel`',
          '`/subscribe add` — pings for a category',
        ].join('\n')),
        theme.field('Boss of the Week', [
          '`/vote botw` — pick the boss',
          '`/boss week` — start tracking KC',
          '`/boss kc` — clan KC board',
        ].join('\n')),
        theme.field('Raffle / bingo', '`/raffle create` `/draw` `/end`\n`/bingo create` `/start` · Claim a tile'),
        theme.field('Lookups', '`/member link` `/clan info` `/leaderboard` `/profile card` `/economy balance`'),
        theme.field('Staff', '`/config view` · `/sotw end` `/cancel` · `/vote cancel`'),
      ],
    });

    await interaction.reply({ embeds: [embed], flags: 64 });
  },
};
