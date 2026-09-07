const { Events } = require('discord.js');

// Discord gateway 503s can last minutes. Killing the process in 45–90s
// is what caused the Render restart storm (HTTP up, login never finished).
const GRACE_MS = 10 * 60_000;
const RECONNECT_MS = 5 * 60_000;
const POLL_MS = 30_000;

function watchDiscord(client) {
  client.bootAt = Date.now();
  let lastReadyAt = 0;
  let reconnectTimer = null;

  function arm(why) {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (client.isReady()) return;
      console.error(`Discord still down after ${why}. Exiting so Render restarts.`);
      process.exit(1);
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
    console.error('HTTP is up but Discord is not. Exiting so Render restarts.');
    process.exit(1);
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
