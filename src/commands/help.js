const { SlashCommandBuilder } = require('discord.js');
const theme = require('../services/theme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all available commands'),

  async execute(interaction) {
    const embed = theme.embed('info', {
      title: 'Clan commands',
      description: 'Same bot as before — members, events, SOTW, raffles. A few extras sit beside those.',
      fields: [
        theme.field('Member', '`/member link` `/unlink` `/whois` `/list`'),
        theme.field('Events', '`/event create` `/list` `/cancel` `/remind`\n`/subscribe add` `/remove` `/list`'),
        theme.field('SOTW', '`/sotw start` `/standings` `/me` `/end` `/queue` `/champions`'),
        theme.field('Leaderboards', '`/leaderboard hiscores` `/gained` `/player`'),
        theme.field('Raffles & votes', '`/raffle create` `/draw` `/end` `/list` `/history`\n`/vote sotw` `/botw` `/generic`'),
        theme.field('Clan', '`/clan info` `/clan sync` `/config view`'),
        theme.field('Also available', [
          '`/profile card` — full stat card',
          '`/bingo create` — paste a list or load Clues; live boards have Claim a tile; `/bingo submit`',
          '`/boss kc` `/boss week` — KC boards and BOTW',
          '`/goal xp` `/goal level` `/goal kc` — pings when you hit it',
          '`/achievements recent` `/economy balance` `/export`',
        ].join('\n')),
      ],
    });

    await interaction.reply({ embeds: [embed], flags: 64 });
  },
};
