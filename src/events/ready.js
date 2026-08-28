const { Events, ActivityType } = require('discord.js');
const { startReminderPoller } = require('../services/reminders');
const { registerCommands } = require('../deploy-commands');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(readyClient, client) {
    console.log(`✅ Logged in as ${readyClient.user.tag}`);
    console.log(`📋 ${client.commands.size} commands loaded`);
    readyClient.user.setPresence({
      status: 'online',
      activities: [{ name: 'Misclickers', type: ActivityType.Watching }],
    });
    startReminderPoller(client);
    console.log('⏰ Reminder poller started');
    registerCommands(readyClient).catch(err => {
      console.warn(`Slash command sync on ready: ${err.message}`);
    });
    const ranks = require('../services/ranks');
    for (const guild of readyClient.guilds.cache.values()) {
      ranks.paintExisting(guild).catch(err => {
        console.warn(`rank color ${guild.name}: ${err.message}`);
      });
    }
  },
};
