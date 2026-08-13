const { SlashCommandBuilder } = require('discord.js');
const { isAdmin, ADMIN_PERMISSION } = require('../services/permissions');
const hooks = require('../services/webhooks');
const theme = require('../services/theme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('webhook')
    .setDescription('Incoming hooks for Twitch, clan news, RuneLite screenshots')
    .setDefaultMemberPermissions(ADMIN_PERMISSION)
    .addSubcommand(sub =>
      sub.setName('create')
        .setDescription('Make an incoming hook token')
        .addStringOption(opt => opt.setName('name').setDescription('Twitch / news / runelite').setRequired(true))
        .addChannelOption(opt => opt.setName('channel').setDescription('Where to post')))
    .addSubcommand(sub => sub.setName('list').setDescription('List hooks (tokens hidden)'))
    .addSubcommand(sub =>
      sub.setName('revoke')
        .setDescription('Delete a hook')
        .addIntegerOption(opt => opt.setName('id').setDescription('Hook ID').setRequired(true))),

  async execute(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({ content: 'Admins own the hooks.', flags: 64 });
    }
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      const name = interaction.options.getString('name');
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const token = hooks.createHook(interaction.guildId, name, channel.id, interaction.user.id);
      const port = process.env.WEBHOOK_PORT || '8787';
      return interaction.reply({
        content: [
          `Hook **${name}** → ${channel}`,
          `POST \`http://<your-pc>:${port}/hook/${token}\``,
          'JSON: `{ "title": "Live", "content": "stream is up", "image_url": "optional", "source": "twitch" }`',
          'Set `WEBHOOK_PORT` in `.env` and restart or this URL is dead.',
          'Keep the token private. I will not show it again.',
        ].join('\n'),
        flags: 64,
      });
    }

    if (sub === 'revoke') {
      const id = interaction.options.getInteger('id');
      const n = hooks.revokeHook(interaction.guildId, id);
      return interaction.reply({ content: n ? `Revoked hook #${id}.` : 'No hook with that id.', flags: 64 });
    }

    const rows = hooks.listHooks(interaction.guildId);
    return interaction.reply({
      embeds: [theme.embed('info', {
        title: 'Incoming hooks',
        description: rows.map(r => `#${r.id} **${r.name}** → <#${r.channel_id}>`).join('\n') || 'None.',
      })],
      flags: 64,
    });
  },
  adminOnly: true,
};
