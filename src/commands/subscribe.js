const { SlashCommandBuilder } = require('discord.js');
const subs = require('../services/subscriptions');

const MASS_CHOICES = [
  { name: 'General', value: 'general' },
  { name: 'Boss Masses', value: 'boss' },
  { name: 'PvM', value: 'pvm' },
  { name: 'Skilling', value: 'skilling' },
  { name: 'Social', value: 'social' },
  { name: 'Raffles', value: 'raffle' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('subscribe')
    .setDescription('Pings for calendar masses — not SOTW or BOTW')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Subscribe to a mass category')
        .addStringOption(opt =>
          opt.setName('category')
            .setDescription('Which mass type to subscribe to')
            .setRequired(true)
            .addChoices(...MASS_CHOICES)))
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Unsubscribe from a category')
        .addStringOption(opt =>
          opt.setName('category')
            .setDescription('Which type to unsubscribe from')
            .setRequired(true)
            .addChoices(
              ...MASS_CHOICES,
              { name: 'SOTW (legacy)', value: 'sotw' },
              { name: 'BOTW (legacy)', value: 'botw' },
            )))
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('Show your current subscriptions')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const category = interaction.options.getString('category');
      const result = await subs.subscribe(interaction.guildId, interaction.user.id, category);
      if (result) {
        await interaction.reply({ content: `✅ Subscribed to **${category}** events. You'll get pinged for relevant reminders.`, flags: 64 });
      } else {
        await interaction.reply({ content: `You're already subscribed to **${category}** events.`, flags: 64 });
      }
      return;
    }

    if (sub === 'remove') {
      const category = interaction.options.getString('category');
      const result = await subs.unsubscribe(interaction.guildId, interaction.user.id, category);
      if (result) {
        await interaction.reply({ content: `✅ Unsubscribed from **${category}** events.`, flags: 64 });
      } else {
        await interaction.reply({ content: `You weren't subscribed to **${category}** events.`, flags: 64 });
      }
      return;
    }

    if (sub === 'list') {
      const subscriptions = await subs.getSubscriptions(interaction.guildId, interaction.user.id);
      if (subscriptions.length === 0) {
        await interaction.reply({ content: 'You have no subscriptions. Use `/subscribe add` to get pinged for event types you care about.', flags: 64 });
      } else {
        await interaction.reply({ content: `**Your subscriptions:**\n${subscriptions.map(s => `• ${s}`).join('\n')}`, flags: 64 });
      }
      return;
    }
  },
};
