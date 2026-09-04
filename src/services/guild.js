const { getDb } = require('../db/database');

function isHomeGuild(guildId) {
  const home = String(process.env.GUILD_ID || process.env.CLAN_GUILD_ID || '').trim();
  return Boolean(home && String(guildId) === home);
}

async function ensureGuildSettings(guildId) {
  const db = getDb();
  const existing = await db.prepare('SELECT guild_id FROM guild_settings WHERE guild_id = ?').get(guildId);
  if (!existing) {
    const home = isHomeGuild(guildId);
    await db.prepare(`
      INSERT INTO guild_settings (guild_id, wom_group_id, wom_verif_code, reminder_channel)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id) DO NOTHING
    `).run(
      guildId,
      home && process.env.WOM_GROUP_ID ? parseInt(process.env.WOM_GROUP_ID, 10) : null,
      home ? (process.env.WOM_VERIFICATION_CODE || null) : null,
      process.env.DEFAULT_REMINDER_CHANNEL || null
    );
  }
  return await db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
}

module.exports = { ensureGuildSettings };
