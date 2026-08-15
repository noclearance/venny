const { SlashCommandBuilder } = require('discord.js');
const { isModerator, STAFF_PERMISSION } = require('../services/permissions');
const { asAttachment } = require('../services/exportCsv');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('export')
    .setDescription('CSV export for Sheets — attendance, SOTW, bingo, raffles')
    .setDefaultMemberPermissions(STAFF_PERMISSION)
    .addStringOption(opt =>
      opt.setName('type').setDescription('What to dump').setRequired(true).addChoices(
        { name: 'Event attendance', value: 'attendance' },
        { name: 'SOTW results', value: 'sotw' },
        { name: 'Bingo progress', value: 'bingo' },
        { name: 'Raffle history', value: 'raffle' },
      )),

  async execute(interaction) {
    if (!isModerator(interaction.member)) {
      return interaction.reply({ content: 'Mods export the books.', flags: 64 });
    }
    const type = interaction.options.getString('type');
    const file = await asAttachment(interaction.guildId, type);
    await interaction.reply({
      content: `Here's **${type}**. Open in Google Sheets → File → Import.`,
      files: [file],
      flags: 64,
    });
  },
  staffOnly: true,
};
