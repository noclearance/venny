const { REST, Routes } = require('discord.js');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

function loadCommandModules() {
  const commandsPath = path.join(__dirname, 'commands');
  return fs.readdirSync(commandsPath)
    .filter(f => f.endsWith('.js'))
    .map(file => require(path.join(commandsPath, file)));
}

function payloadsForSettings(settings = {}) {
  const commands = [];
  for (const command of loadCommandModules()) {
    if (command.buildData) {
      commands.push(command.buildData(settings).toJSON());
    } else if (command.data) {
      commands.push(command.data.toJSON());
    }
    if (command.contextData) {
      commands.push(command.contextData.toJSON());
    }
  }
  return commands;
}

async function guildSettings(guildId) {
  try {
    const { getDb } = require('./db/database');
    return await getDb().prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId) || {};
  } catch {
    return {};
  }
}

function restClient() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.CLIENT_ID;
  if (!token || token.startsWith('your_')) {
    throw new Error('DISCORD_TOKEN is missing. Put your bot token in .env');
  }
  if (!clientId || clientId.startsWith('your_')) {
    throw new Error('CLIENT_ID is missing. Put your Application ID in .env');
  }
  return { rest: new REST({ version: '10' }).setToken(token), clientId };
}

async function syncGuildCommands(guildId) {
  const { rest, clientId } = restClient();
  const settings = await guildSettings(guildId);
  const commands = payloadsForSettings(settings);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
  const hidden = (require('./commands/config').missingChannelSlots(settings).length === 0)
    ? 'channel setup hidden'
    : 'channel setup visible';
  console.log(`Slash commands synced for guild ${guildId} (${commands.length}, ${hidden}).`);
  return commands.length;
}

async function registerCommands(client) {
  const { rest, clientId } = restClient();
  const guildIds = new Set();
  if (client?.guilds?.cache) {
    for (const guild of client.guilds.cache.values()) guildIds.add(guild.id);
  }
  if (process.env.GUILD_ID) guildIds.add(process.env.GUILD_ID);

  if (guildIds.size) {
    for (const guildId of guildIds) {
      await syncGuildCommands(guildId);
    }
    return;
  }

  const commands = payloadsForSettings({});
  console.log(`Registering ${commands.length} global slash commands...`);
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log('Global commands registered (may take up to 1 hour to appear).');
}

if (require.main === module) {
  const { initDb } = require('./db/database');
  initDb()
    .then(() => registerCommands())
    .catch(err => {
      console.error('Failed to register commands:', err);
      process.exit(1);
    });
}

module.exports = { registerCommands, syncGuildCommands, payloadsForSettings };
