const theme = require('./theme');
const flavor = require('./flavor');
const announce = require('./announce');
const hub = require('./aisBot');

function joinDescription(json, extraLines = []) {
  const body = json?.description || '';
  const extras = extraLines.filter(line => line && line !== body);
  return [body, ...extras].filter(Boolean).join('\n\n');
}

async function make(kind, {
  job,
  facts = {},
  fallbackTitle,
  fallbackDescription,
  fields,
  thumbnail,
  url,
  footer,
  timestamp,
  extraLines = [],
} = {}) {
  const json = job
    ? await flavor.announce(job, facts, { fallbackTitle, fallbackDescription })
    : {
        title: fallbackTitle || '',
        description: fallbackDescription || '',
        source: 'none',
      };
  return {
    json,
    embed: theme.fromJson(kind, { ...json, description: joinDescription(json, extraLines) }, {
      fields,
      thumbnail,
      url,
      footer,
      timestamp,
    }),
  };
}

async function publish(client, guildId, {
  kind,
  json,
  fields,
  extraLines = [],
  sourceChannelId,
  sourceMessageId,
  mention,
  event = 'webhook',
} = {}) {
  const face = extraLines.length
    ? { ...json, description: joinDescription(json, extraLines) }
    : json;
  const posted = await announce.broadcast(client, guildId, {
    kind,
    json: face,
    fields,
    sourceChannelId,
    sourceMessageId,
    mention,
  });
  if (event && posted && json) {
    hub.emit(event, {
      type: event,
      guild_id: guildId,
      kind,
      title: json.title || null,
      description: json.description || null,
      source: json.source || null,
      jump: announce.jumpUrl(guildId, posted.channelId, posted.id),
      ts: new Date().toISOString(),
    });
  }
  return posted;
}

module.exports = { make, publish, joinDescription };
