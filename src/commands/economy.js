const { SlashCommandBuilder } = require('discord.js');
const theme = require('../services/theme');
const economy = require('../services/economy');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('economy')
    .setDescription('Clan coins from masses, bingo, SOTW, and flags')
    .addSubcommand(sub =>
      sub.setName('balance')
        .setDescription('Check coin balance')
        .addUserOption(opt => opt.setName('user').setDescription('Someone else')))
    .addSubcommand(sub =>
      sub.setName('leaderboard')
        .setDescription('Richest linked members')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'balance') {
      const user = interaction.options.getUser('user') || interaction.user;
      const coins = economy.getBalance(interaction.guildId, user.id);
      return interaction.reply({
        embeds: [theme.embed('brand', {
          title: 'Pouch',
          description: [
            `${user} is sitting on **${coins.toLocaleString()}** credits.`,
            economy.payRates('event_rsvp', 'raffle_enter', 'raffle_win', 'sotw_win', 'bingo_tile', 'achievement', 'goal'),
          ].join('\n\n'),
        })],
      });
    }

    const rows = economy.leaderboard(interaction.guildId);
    return interaction.reply({
      embeds: [theme.embed('brand', {
        title: 'Bank rats',
        description: theme.rankLines(rows, r => `<@${r.user_id}> — **${r.coins.toLocaleString()}**`) || 'Nobody has earned a coin yet.',
      })],
    });
  },
};
