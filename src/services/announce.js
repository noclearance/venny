const theme = require('./theme');
const {
  resolveConfiguredChannel,
  clearConfiguredSlot,
  isMissingDiscordChannel,
} = require('./channelRouting');

function jumpUrl(guildId, channelId, messageId) {
  if (!guildId || !channelId || !messageId) return null;
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

async function broadcast(client, guildId, {
  kind = 'brand',
  json,
  title,
  description,
  fields,
  sourceChannelId,
  sourceMessageId,
  mention,
} = {}) {
  if (!client || !guildId) return null;
  const route = await resolveConfiguredChannel(client, guildId, {
    slots: ['announce_channel'],
    allowFallback: false,
  });
  if (!route?.channelId) return null;
  if (sourceChannelId && String(sourceChannelId) === String(route.channelId)) return null;

  const face = json || { title, description };
  const jump = jumpUrl(guildId, sourceChannelId, sourceMessageId);
  const extra = [...(fields || [])];
  if (jump) extra.push(theme.field('Details', `[Click here to view the event!](${jump})`));

  try {
    const channel = route.channel;
    const ping = mention && typeof mention === 'object'
      ? mention
      : { content: mention || undefined, allowedMentions: mention ? { parse: ['roles', 'users'] } : { parse: [] } };
    return channel.send({
      content: ping.content || undefined,
      allowedMentions: ping.allowedMentions || { parse: [] },
      embeds: [theme.fromJson(kind, face, {
        fields: extra,
        url: jump || undefined,
        timestamp: true,
      })],
    });
  } catch (err) {
    console.warn(`Announce channel failed: ${err.message}`);
    if (isMissingDiscordChannel(err)) {
      await clearConfiguredSlot(guildId, route.slot);
    }
    return null;
  }
}

module.exports = { broadcast, jumpUrl };
