const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const ranks = require('../services/ranks');
const { commandFail } = require('../services/commandFail');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Give or take clan ranks — Venny governs the ladder')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(sub =>
      sub.setName('set')
        .setDescription('Put them on one clan rank (the others come off)')
        .addUserOption(opt => opt.setName('user').setDescription('Who').setRequired(true))
        .addStringOption(opt =>
          opt.setName('rank')
            .setDescription('Which rank')
            .setRequired(true)
            .addChoices(...ranks.rankChoices())))
    .addSubcommand(sub =>
      sub.setName('clear')
        .setDescription('Take all clan ranks off')
        .addUserOption(opt => opt.setName('user').setDescription('Who').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('who')
        .setDescription('Which clan rank they have')
        .addUserOption(opt => opt.setName('user').setDescription('Who').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser('user');
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return commandFail(interaction, 'You need **Manage Roles**.');
    }

    if (sub === 'who') {
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return commandFail(interaction, 'They are not in this server.');
      const key = ranks.currentKey(member);
      const name = key ? ranks.clanRankNames()[key] : null;
      await interaction.editReply({
        content: name ? `<@${user.id}> is **${name}**.` : `<@${user.id}> has none of the clan ranks.`,
      });
      return;
    }

    try {
      if (sub === 'clear') {
        const out = await ranks.clearRanks(interaction.client, interaction.guildId, user.id, {
          reason: `by ${interaction.user.tag}`,
        });
        await interaction.editReply({
          content: out.removed.length
            ? `Cleared ${out.removed.map(n => `**${n}**`).join(', ')} from <@${user.id}>.`
            : `<@${user.id}> had no clan ranks.`,
        });
        return;
      }
      const key = interaction.options.getString('rank');
      const out = await ranks.applyRank(interaction.client, interaction.guildId, user.id, key, {
        reason: `by ${interaction.user.tag}`,
      });
      const taken = out.removed.length ? ` Took off ${out.removed.map(r => `**${r.name}**`).join(', ')}.` : '';
      await interaction.editReply({ content: `<@${user.id}> is **${out.rank}**.${taken}` });
    } catch (err) {
      return commandFail(interaction, err);
    }
  },
};
