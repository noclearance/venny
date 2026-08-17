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
  job,
  facts,
  card,
} = {}) {
  if (!client || !guildId) return null;
  const settings = await getDb().prepare('SELECT announce_channel, reminder_channel FROM guild_settings WHERE guild_id = ?').get(guildId);
  const channelId = settings?.announce_channel || settings?.reminder_channel;
  if (!channelId) return null;
  if (sourceChannelId && String(sourceChannelId) === String(channelId)) return null;

  let json = card;
  if (!json && job) {
    json = await require('./flavor').announce(job, facts || { title, description });
  }
  if (!json) {
    json = { title, description };
  }

  const jump = jumpUrl(guildId, sourceChannelId, sourceMessageId);
  const extra = [...(fields || [])];
  if (jump) extra.push(theme.field('Details', `[Click here to view the event!](${jump})`));

  try {
    const channel = await client.channels.fetch(channelId);
    return channel.send({
      content: mention || undefined,
      allowedMentions: mention ? { parse: ['roles', 'users'] } : { parse: [] },
      embeds: [theme.fromJson(kind, json, {
        fields: extra,
        url: jump || undefined,
        timestamp: true,
      })],
    });
  } catch (err) {
    console.warn(`Announce channel failed: ${err.message}`);
    if (/Missing Access|Unknown Channel|Missing Permissions/i.test(err.message || '')) {
      await getDb().prepare('UPDATE guild_settings SET announce_channel = NULL WHERE guild_id = ?').run(guildId);
    }
    return null;
  }
}

module.exports = { broadcast, jumpUrl };
