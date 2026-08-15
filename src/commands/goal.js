const { SlashCommandBuilder } = require('discord.js');
const { getDb } = require('../db/database');
const theme = require('../services/theme');
const wom = require('../services/wom');
const goals = require('../services/goals');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('goal')
    .setDescription('XP and level goals — I ping you when WOM sees it')
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
    .addSubcommand(sub => sub.setName('clear').setDescription('Clear your open goals')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const db = getDb();
    const member = await db.prepare('SELECT * FROM members WHERE guild_id = ? AND user_id = ?').get(interaction.guildId, interaction.user.id);
    if (!member && sub !== 'list') {
      return interaction.reply({ content: 'Link an RSN first: `/member link`.', flags: 64 });
    }

    if (sub === 'xp') {
      const amount = interaction.options.getInteger('amount');
      const id = await goals.addXpGoal(interaction.guildId, interaction.user.id, amount);
      return interaction.reply({
        embeds: [theme.embed('success', {
          title: 'XP goal set',
          description: `I'll ping you at **${amount.toLocaleString()}** total XP. Ticket #${id}.`,
        })],
        flags: 64,
      });
    }

    if (sub === 'level') {
      const skill = interaction.options.getString('skill');
      const level = interaction.options.getInteger('level');
      const id = await goals.addLevelGoal(interaction.guildId, interaction.user.id, skill, level);
      return interaction.reply({
        embeds: [theme.embed('success', {
          title: 'Level goal set',
          description: `${skill} ${level}. I'll ping when WOM sees it. #${id}.`,
          thumbnail: theme.skillIconUrl(skill),
        })],
        flags: 64,
      });
    }

    if (sub === 'kc') {
      const boss = interaction.options.getString('boss');
      const amount = interaction.options.getInteger('amount');
      const id = await goals.addKcGoal(interaction.guildId, interaction.user.id, boss, amount);
      return interaction.reply({
        embeds: [theme.embed('success', {
          title: 'KC goal set',
          description: `${amount.toLocaleString()} ${boss} KC. I'll ping when WOM sees it. #${id}.`,
        })],
        flags: 64,
      });
    }

    if (sub === 'clear') {
      const n = await goals.clearGoals(interaction.guildId, interaction.user.id);
      return interaction.reply({ content: `Cleared ${n} open goal${n === 1 ? '' : 's'}.`, flags: 64 });
    }

    const open = await goals.listGoals(interaction.guildId, interaction.user.id);
    return interaction.reply({
      embeds: [theme.embed('info', {
        title: 'Your goals',
        description: open.map(g => {
          if (g.kind === 'xp') return `#${g.id} · ${g.target.toLocaleString()} total XP`;
          if (g.kind === 'kc') return `#${g.id} · ${g.target.toLocaleString()} ${g.skill} KC`;
          return `#${g.id} · ${g.skill} ${g.target}`;
        }).join('\n') || 'None set.',
      })],
      flags: 64,
    });
  },
};
