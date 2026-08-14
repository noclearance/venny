const { SlashCommandBuilder } = require('discord.js');
const { getDb } = require('../db/database');
const { buildProfile } = require('../services/profile');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Rich OSRS profile card for a linked member')
    .addSubcommand(sub =>
      sub.setName('card')
        .setDescription('Show a data-dense profile card')
        .addUserOption(opt => opt.setName('user').setDescription('Whose card (default: you)'))),

  async execute(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const db = getDb();
    const member = db.prepare('SELECT * FROM members WHERE guild_id = ? AND user_id = ?').get(interaction.guildId, target.id);
    if (!member) {
      return interaction.reply({ content: `${target} has no linked RSN. \`/member link\` first.`, flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });
    try {
      const discordMember = await interaction.guild.members.fetch(target.id).catch(() => null);
      const card = await buildProfile({
        guildId: interaction.guildId,
        user: target,
        memberRow: member,
        discordMember,
      });
      await interaction.editReply({ embeds: card.embeds });
    } catch (err) {
      await interaction.editReply(`Couldn't build that card: ${err.message}`);
    }
  },
};
