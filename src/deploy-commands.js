const { REST, Routes } = require('discord.js');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

function loadCommandPayloads() {
  const commands = [];
  const commandsPath = path.join(__dirname, 'commands');
  const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

  for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if (command.data) {
      commands.push(command.data.toJSON());
    }
    if (command.contextData) {
      commands.push(command.contextData.toJSON());
    }
  }
  return commands;
}

async function registerCommands() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.CLIENT_ID;

  if (!token || token.startsWith('your_')) {
    throw new Error('DISCORD_TOKEN is missing. Put your bot token in .env');
  }
  if (!clientId || clientId.startsWith('your_')) {
    throw new Error('CLIENT_ID is missing. Put your Application ID in .env');
  }

  const commands = loadCommandPayloads();
  const rest = new REST({ version: '10' }).setToken(token);

  console.log(`Registering ${commands.length} slash commands...`);

  if (process.env.GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(clientId, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('✅ Guild commands registered (instant).');
  } else {
    await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands }
    );
    console.log('✅ Global commands registered (may take up to 1 hour to appear).');
  }
}

if (require.main === module) {
  registerCommands().catch(err => {
    console.error('Failed to register commands:', err);
    process.exit(1);
  });
}

module.exports = { registerCommands };
