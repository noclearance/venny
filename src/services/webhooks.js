const http = require('http');
const crypto = require('crypto');
const { getDb } = require('../db/database');
const theme = require('./theme');

function createHook(guildId, name, channelId, createdBy) {
  const token = crypto.randomBytes(18).toString('hex');
  getDb().prepare(`
    INSERT INTO incoming_webhooks (guild_id, name, token, channel_id, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(guildId, name, token, channelId, createdBy);
  return token;
}

function listHooks(guildId) {
  return getDb().prepare('SELECT id, name, channel_id, created_at FROM incoming_webhooks WHERE guild_id = ?').all(guildId);
}

function revokeHook(guildId, id) {
  return getDb().prepare('DELETE FROM incoming_webhooks WHERE id = ? AND guild_id = ?').run(id, guildId).changes;
}

function findHook(token) {
  return getDb().prepare('SELECT * FROM incoming_webhooks WHERE token = ?').get(token);
}

function startServer(client) {
  const port = Number(process.env.WEBHOOK_PORT || 0);
  if (!port) {
    console.log('Webhook HTTP server off (set WEBHOOK_PORT to enable Twitch/RuneLite hooks).');
    return null;
  }

  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || !req.url.startsWith('/hook/')) {
      res.writeHead(404).end('not found');
      return;
    }
    const token = req.url.slice('/hook/'.length).split('?')[0];
    const hook = findHook(token);
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
