const { Events } = require('discord.js');

// Discord gateway 503s can last minutes. Killing the process too quickly
// can cause restart storms on always-on hosts (HTTP up, login not finished).
const HARD_EXIT = /^(1|true|yes)$/i.test(String(process.env.DISCORD_EXIT_ON_DOWN || ''));
const DEFAULT_GRACE_MS = 10 * 60_000;
const DEFAULT_RECONNECT_MS = 5 * 60_000;
const GRACE_MS = Number(process.env.DISCORD_READY_GRACE_MS) || DEFAULT_GRACE_MS;
const RECONNECT_MS = Number(process.env.DISCORD_RECONNECT_MS) || DEFAULT_RECONNECT_MS;
const POLL_MS = 30_000;

function watchDiscord(client) {
  client.bootAt = Date.now();
  let lastReadyAt = 0;
  let reconnectTimer = null;

  function exitOrStayUp(message) {
    if (HARD_EXIT) {
      console.error(`${message} Exiting so Render restarts.`);
      process.exit(1);
      return;
    }

    console.error(`${message} Staying up; set DISCORD_EXIT_ON_DOWN=1 to force exit.`);
  }

  function arm(why) {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (client.isReady()) return;
      exitOrStayUp(`Discord still down after ${why}.`);
    }, RECONNECT_MS);
  }

  function clear() {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function markReady() {
    lastReadyAt = Date.now();
    clear();
  }

  setInterval(() => {
    if (client.isReady()) return;
    const now = Date.now();
    if (now - client.bootAt < GRACE_MS) return;
    if (lastReadyAt && now - lastReadyAt < RECONNECT_MS) return;
    exitOrStayUp('HTTP is up but Discord is not.');
  }, POLL_MS).unref();

  client.on(Events.Error, err => {
    console.error('Discord client error:', err.message);
  });
  client.on(Events.ShardError, (err, id) => {
    console.warn(`Discord shard ${id} error:`, err.message);
  });
  client.on(Events.ShardDisconnect, (event, id) => {
    console.warn(`Discord shard ${id} disconnected (${event?.code || '?'}). Waiting to resume.`);
    arm(`shard ${id} disconnect`);
  });
  client.on(Events.ShardResume, () => {
    console.log('Discord shard resumed.');
    markReady();
  });
  client.on(Events.ClientReady, markReady);
  client.on(Events.Invalidated, () => {
    console.error('Discord session invalidated. Exiting so Render restarts.');
    process.exit(1);
  });
}

module.exports = { watchDiscord, GRACE_MS, RECONNECT_MS };
