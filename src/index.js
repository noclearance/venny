const { Client, GatewayIntentBits, Collection, Partials } = require('discord.js');
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { initDb } = require('./db/database');
const { ensureGuildSettings } = require('./services/guild');
const { registerCommands } = require('./deploy-commands');

function validateEnv() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.CLIENT_ID;

  if (!token || token.startsWith('your_')) {
    console.error('❌ DISCORD_TOKEN is missing. Open .env and paste the Bot token from the Discord Developer Portal.');
    process.exit(1);
  }

  if (token.length < 50) {
    console.warn('⚠️  DISCORD_TOKEN looks short (Discord bot tokens are usually 59+ characters).');
    console.warn('   Make sure you copied the Bot token (Bot tab → Reset Token), not the client secret.');
  }

  if (!clientId || clientId.startsWith('your_')) {
    console.warn('⚠️  CLIENT_ID is missing. Slash command registration will fail until you set it in .env.');
  }
}

async function boot() {
validateEnv();
await initDb();

const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
];
if (GatewayIntentBits.GuildMessagePolls) {
  intents.push(GatewayIntentBits.GuildMessagePolls);
}

const client = new Client({
  intents,
  partials: [Partials.Channel],
});

client.commands = new Collection();
client.ensureGuildSettings = ensureGuildSettings;

const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  if (command.data) {
    client.commands.set(command.data.name, command);
  }
}

const eventsPath = path.join(__dirname, 'events');
for (const file of fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'))) {
  const event = require(path.join(eventsPath, file));
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args, client));
  } else {
    client.on(event.name, (...args) => event.execute(...args, client));
  }
}

registerCommands().catch(err => {
  console.error('Failed to register slash commands on startup:', err.message);
  console.error('The bot will still start. Run `npm run register` after fixing CLIENT_ID / DISCORD_TOKEN.');
});

  client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('❌ Discord login failed:', err.message);
    console.error('Check DISCORD_TOKEN in .env and that the bot is invited to your server.');
    process.exit(1);
  });
}

boot().catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});
