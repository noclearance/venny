const { SlashCommandBuilder } = require('discord.js');
const theme = require('../services/theme');
const economy = require('../services/economy');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('economy')
    .setDescription('Guild credits from masses, bingo, SOTW, and flags')
    .addSubcommand(sub =>
      sub.setName('balance')
        .setDescription('Check guild credit balance')
        .addUserOption(opt => opt.setName('user').setDescription('Someone else')))
    .addSubcommand(sub =>
      sub.setName('leaderboard')
        .setDescription('Richest linked members')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'balance') {
      const user = interaction.options.getUser('user') || interaction.user;
      const coins = await economy.getBalance(interaction.guildId, user.id);
      return interaction.reply({
        embeds: [theme.embed('brand', {
          title: 'Guild credits',
          description: [
            `${user} is sitting on **${coins.toLocaleString()}** guild credits.`,
            economy.payRates('event_rsvp', 'raffle_enter', 'raffle_win', 'sotw_win', 'bingo_tile', 'achievement', 'goal'),
          ].join('\n\n'),
        })],
        flags: 64,
      });
    }

    const rows = await economy.leaderboard(interaction.guildId);
    return interaction.reply({
      embeds: [theme.embed('brand', {
        title: 'Guild credits',
        description: theme.rankLines(rows, r => `<@${r.user_id}> — **${r.coins.toLocaleString()}**`) || 'Nobody has earned guild credits yet.',
      })],
      flags: 64,
    });
  },
};
