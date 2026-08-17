const http = require('http');
const crypto = require('crypto');
const { getDb } = require('../db/database');
const theme = require('./theme');

async function createHook(guildId, name, channelId, createdBy) {
  const token = crypto.randomBytes(18).toString('hex');
  await getDb().prepare(`
    INSERT INTO incoming_webhooks (guild_id, name, token, channel_id, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(guildId, name, token, channelId, createdBy);
  return token;
}

async function listHooks(guildId) {
  return await getDb().prepare('SELECT id, name, channel_id, created_at FROM incoming_webhooks WHERE guild_id = ?').all(guildId);
}

async function revokeHook(guildId, id) {
  return (await getDb().prepare('DELETE FROM incoming_webhooks WHERE id = ? AND guild_id = ?').run(id, guildId)).changes;
}

async function findHook(token) {
  return await getDb().prepare('SELECT * FROM incoming_webhooks WHERE token = ?').get(token);
}

let server;

function startServer(client) {
  if (server) return server;
  // Render Web Services set PORT and refuse to stay up unless something binds it.
  const port = Number(process.env.PORT || process.env.WEBHOOK_PORT || 0);
  if (!port) {
    console.log('Webhook HTTP server off (set WEBHOOK_PORT to enable Twitch/RuneLite hooks).');
    return null;
  }

  server = http.createServer(async (req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (req.method === 'GET' && (url === '/' || url === '/health')) {
      const ready = Boolean(client?.isReady?.());
      if (url === '/health' && !ready) {
        res.writeHead(503, { 'Content-Type': 'text/plain' }).end('discord offline');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end(ready ? 'venny ok' : 'venny starting');
      return;
    }
    if (req.method !== 'POST' || !url.startsWith('/hook/')) {
      res.writeHead(404).end('not found');
      return;
    }
    const token = url.slice('/hook/'.length);
    const hook = await findHook(token);
    if (!hook) {
      res.writeHead(401).end('bad token');
      return;
    }

    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 200_000) req.destroy();
    });
    req.on('end', async () => {
      try {
        const body = raw ? JSON.parse(raw) : {};
        const channel = await client.channels.fetch(hook.channel_id);
        const title = String(body.title || hook.name).slice(0, 200);
        const content = String(body.content || body.message || 'External ping.').slice(0, 1800);
        const embed = theme.embed('info', {
          title,
          description: content,
          footer: body.source || 'incoming webhook',
        });
        if (body.image_url) embed.setImage(String(body.image_url));
        await channel.send({ embeds: [embed] });
        res.writeHead(204).end();
      } catch (err) {
        console.error('Webhook post failed:', err.message);
        res.writeHead(400).end('bad payload');
      }
    });
  });

  server.listen(port, () => {
    console.log(`Webhook server listening on :${port}  POST /hook/<token>`);
  });
  return server;
}

module.exports = { createHook, listHooks, revokeHook, startServer };
