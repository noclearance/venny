const { Events } = require('discord.js');
const { startReminderPoller } = require('../services/reminders');
const { startServer } = require('../services/webhooks');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(readyClient, client) {
    console.log(`✅ Logged in as ${readyClient.user.tag}`);
    console.log(`📋 ${client.commands.size} commands loaded`);
    startReminderPoller(client);
    console.log('⏰ Reminder poller started');
    startServer(client);
  },
};
