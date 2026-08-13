const { getDb } = require('../db/database');

const warned = new Set();

async function audit(client, guildId, text) {
  if (!client || !guildId || !text) return;

  const db = getDb();
  const settings = db.prepare('SELECT audit_channel FROM guild_settings WHERE guild_id = ?').get(guildId);
  if (!settings?.audit_channel) return;

  try {
    const channel = await client.channels.fetch(settings.audit_channel);
    if (!channel) return;
    await channel.send({ content: `📝 ${text}` });
  } catch (err) {
    if (!warned.has(guildId)) {
      warned.add(guildId);
      console.warn('Audit channel is set but the bot cannot post there (Missing Access). Clearing it. Set `/config audit-channel` again in a channel Venny can see.');
      db.prepare('UPDATE guild_settings SET audit_channel = NULL WHERE guild_id = ?').run(guildId);
    }
  }
}

module.exports = { audit };
