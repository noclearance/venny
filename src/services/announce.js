const { getDb } = require('../db/database');
const theme = require('./theme');

function jumpUrl(guildId, channelId, messageId) {
  if (!guildId || !channelId || !messageId) return null;
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

async function broadcast(client, guildId, {
  kind = 'brand',
  title,
  description,
  fields,
  sourceChannelId,
  sourceMessageId,
  mention,
} = {}) {
  if (!client || !guildId) return null;
  const settings = getDb().prepare('SELECT announce_channel, reminder_channel FROM guild_settings WHERE guild_id = ?').get(guildId);
  const channelId = settings?.announce_channel || settings?.reminder_channel;
  if (!channelId) return null;
  if (sourceChannelId && String(sourceChannelId) === String(channelId)) return null;

  const jump = jumpUrl(guildId, sourceChannelId, sourceMessageId);
  const extra = [...(fields || [])];
  if (jump) extra.push(theme.field('Jump in', `[Open the post](${jump})`));

  try {
    const channel = await client.channels.fetch(channelId);
    return channel.send({
      content: mention || undefined,
      allowedMentions: mention ? { parse: ['roles', 'users'] } : { parse: [] },
      embeds: [theme.embed(kind, {
        title,
        description,
        fields: extra,
        url: jump || undefined,
      })],
    });
  } catch (err) {
    console.warn(`Announce channel failed: ${err.message}`);
    if (/Missing Access|Unknown Channel|Missing Permissions/i.test(err.message || '')) {
      getDb().prepare('UPDATE guild_settings SET announce_channel = NULL WHERE guild_id = ?').run(guildId);
    }
    return null;
  }
}

module.exports = { broadcast, jumpUrl };
