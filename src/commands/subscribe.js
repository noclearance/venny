const { SlashCommandBuilder } = require('discord.js');
const subs = require('../services/subscriptions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('subscribe')
    .setDescription('Subscribe to event categories to get pinged for relevant events')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Subscribe to an event category')
        .addStringOption(opt =>
          opt.setName('category')
            .setDescription('Which event type to subscribe to')
            .setRequired(true)
            .addChoices(
              { name: 'General', value: 'general' },
              { name: 'Boss Masses', value: 'boss' },
              { name: 'PvM', value: 'pvm' },
              { name: 'Skilling', value: 'skilling' },
              { name: 'Social', value: 'social' },
              { name: 'SOTW', value: 'sotw' },
              { name: 'BOTW', value: 'botw' },
              { name: 'Raffles', value: 'raffle' },
            )))
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Unsubscribe from an event category')
        .addStringOption(opt =>
          opt.setName('category')
            .setDescription('Which event type to unsubscribe from')
            .setRequired(true)
            .addChoices(
              { name: 'General', value: 'general' },
              { name: 'Boss Masses', value: 'boss' },
              { name: 'PvM', value: 'pvm' },
              { name: 'Skilling', value: 'skilling' },
              { name: 'Social', value: 'social' },
              { name: 'SOTW', value: 'sotw' },
              { name: 'BOTW', value: 'botw' },
              { name: 'Raffles', value: 'raffle' },
            )))
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('Show your current subscriptions')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const category = interaction.options.getString('category');
      const result = subs.subscribe(interaction.guildId, interaction.user.id, category);
      if (result) {
        await interaction.reply({ content: `✅ Subscribed to **${category}** events. You'll get pinged for relevant reminders.`, flags: 64 });
      } else {
        await interaction.reply({ content: `You're already subscribed to **${category}** events.`, flags: 64 });
      }
      return;
    }

    if (sub === 'remove') {
      const category = interaction.options.getString('category');
      const result = subs.unsubscribe(interaction.guildId, interaction.user.id, category);
      if (result) {
        await interaction.reply({ content: `✅ Unsubscribed from **${category}** events.`, flags: 64 });
      } else {
        await interaction.reply({ content: `You weren't subscribed to **${category}** events.`, flags: 64 });
      }
      return;
    }

    if (sub === 'list') {
      const subscriptions = subs.getSubscriptions(interaction.guildId, interaction.user.id);
      if (subscriptions.length === 0) {
        await interaction.reply({ content: 'You have no subscriptions. Use `/subscribe add` to get pinged for event types you care about.', flags: 64 });
      } else {
        await interaction.reply({ content: `**Your subscriptions:**\n${subscriptions.map(s => `• ${s}`).join('\n')}`, flags: 64 });
      }
      return;
    }
  },
};
