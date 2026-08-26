const { SlashCommandBuilder } = require('discord.js');
const wom = require('../services/wom');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('me')
    .setDescription('Your RSN, profile, credits, and goals')
    .addSubcommand(sub =>
      sub.setName('link')
        .setDescription('Link your Discord to your OSRS RSN')
        .addStringOption(opt =>
          opt.setName('rsn')
            .setDescription('Your Old School RuneScape username')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('unlink')
        .setDescription('Remove your RSN link'))
    .addSubcommand(sub =>
      sub.setName('profile')
        .setDescription('Your OSRS card (or someone linked)')
        .addUserOption(opt => opt.setName('user').setDescription('Whose card (default: you)')))
    .addSubcommand(sub =>
      sub.setName('balance')
        .setDescription('Guild credit balance')
        .addUserOption(opt => opt.setName('user').setDescription('Someone else')))
    .addSubcommandGroup(group =>
      group.setName('goals')
        .setDescription('XP, level, and KC goals — I ping when WOM sees it')
        .addSubcommand(sub =>
          sub.setName('xp')
            .setDescription('Set a total XP goal')
            .addIntegerOption(opt => opt.setName('amount').setDescription('Target total XP').setRequired(true).setMinValue(1)))
        .addSubcommand(sub =>
          sub.setName('level')
            .setDescription('Set a skill level goal')
            .addStringOption(opt => opt.setName('skill').setDescription('Skill').setRequired(true).addChoices(...wom.SKILL_CHOICES))
            .addIntegerOption(opt => opt.setName('level').setDescription('Target level').setRequired(true).setMinValue(2).setMaxValue(99)))
        .addSubcommand(sub =>
          sub.setName('kc')
            .setDescription('Set a boss KC goal')
            .addStringOption(opt => opt.setName('boss').setDescription('Boss').setRequired(true).addChoices(...require('../osrs/catalog').BOSS_CHOICES))
            .addIntegerOption(opt => opt.setName('amount').setDescription('Target kills').setRequired(true).setMinValue(1)))
        .addSubcommand(sub => sub.setName('list').setDescription('Your open goals'))
        .addSubcommand(sub => sub.setName('clear').setDescription('Clear your open goals'))),

  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    if (group === 'goals') {
      return require('./goal').execute(interaction);
    }
    if (sub === 'link' || sub === 'unlink') {
      return require('./member').execute(interaction);
    }
    if (sub === 'profile') {
      return require('./profile').execute(interaction);
    }
    if (sub === 'balance') {
      return require('./economy').execute(interaction);
    }
    return require('../services/commandFail').commandFail(interaction, `Unknown /me option **${sub}**.`);
  },
};
