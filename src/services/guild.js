const { getDb } = require('../db/database');

async function ensureGuildSettings(guildId) {
  const db = getDb();
  const existing = await db.prepare('SELECT guild_id FROM guild_settings WHERE guild_id = ?').get(guildId);
  if (!existing) {
    await db.prepare(`
      INSERT INTO guild_settings (guild_id, wom_group_id, wom_verif_code, reminder_channel)
      VALUES (?, ?, ?, ?)
    `).run(
      guildId,
      process.env.WOM_GROUP_ID ? parseInt(process.env.WOM_GROUP_ID, 10) : null,
      process.env.WOM_VERIFICATION_CODE || null,
      process.env.DEFAULT_REMINDER_CHANNEL || null
    );
  }
  return await db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
}

module.exports = { ensureGuildSettings };
