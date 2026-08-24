const { Events } = require('discord.js');

const GRACE_MS = 90_000;
const RECONNECT_MS = 45_000;
const POLL_MS = 30_000;

function watchDiscord(client) {
  client.bootAt = Date.now();
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

  setInterval(() => {
    if (client.isReady()) return;
    if (Date.now() - client.bootAt < GRACE_MS) return;
    console.error('HTTP is up but Discord is not. Exiting so Render restarts.');
    process.exit(1);
  }, POLL_MS).unref();

  client.on(Events.Error, err => {
    console.error('Discord client error:', err.message);
  });
  client.on(Events.ShardError, (err, id) => {
    console.error(`Discord shard ${id} error:`, err.message);
  });
  client.on(Events.ShardDisconnect, (event, id) => {
    console.error(`Discord shard ${id} disconnected (${event?.code || '?'}).`);
    arm(`shard ${id} disconnect`);
  });
  client.on(Events.ShardResume, () => {
    console.log('Discord shard resumed.');
    clear();
  });
  client.on(Events.ClientReady, clear);
  client.on(Events.Invalidated, () => {
    console.error('Discord session invalidated. Exiting so Render restarts.');
    process.exit(1);
  });
}

module.exports = { watchDiscord };
