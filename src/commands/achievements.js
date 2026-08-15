const { SlashCommandBuilder } = require('discord.js');
const theme = require('../services/theme');
const tracker = require('../services/achievements');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('achievements')
    .setDescription('Recent 99s, KC milestones, clog, and capes')
    .addSubcommand(sub =>
      sub.setName('recent')
        .setDescription('Show recent clan or player achievements')
        .addUserOption(opt => opt.setName('user').setDescription('Filter to one person'))),

  async execute(interaction) {
    const target = interaction.options.getUser('user');
    const rows = await tracker.recent(interaction.guildId, target?.id || null, 15);
    if (!rows.length) {
      return interaction.reply({
        embeds: [theme.embed('muted', {
          title: 'Achievements',
          description: target
            ? 'Nothing logged for them yet. I pick these up while scanning linked RSNs.'
            : 'Board is empty. Link RSNs and I will start catching 99s and KC marks.',
        })],
        flags: 64,
      });
    }

    await interaction.reply({
      embeds: [theme.embed('sotw', {
        title: target ? `Flags · ${target.username}` : 'Recent clan flags',
        description: rows.map(r => {
          const when = r.earned_at ? `<t:${Math.floor(new Date(r.earned_at).getTime() / 1000)}:R>` : '';
          return `• **${r.title}** — <@${r.user_id}> ${when}`;
        }).join('\n'),
      })],
      flags: 64,
    });
  },
};
