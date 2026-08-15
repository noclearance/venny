const { Events } = require('discord.js');
const { ensureGuildSettings } = require('../services/guild');

module.exports = {
  name: Events.GuildCreate,
  async execute(guild) {
    await ensureGuildSettings(guild.id);
    console.log(`Joined new guild: ${guild.name} (${guild.id})`);
  },
};
