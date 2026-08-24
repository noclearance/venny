const { Events, ActivityType } = require('discord.js');
const { startReminderPoller } = require('../services/reminders');

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
  },
};
