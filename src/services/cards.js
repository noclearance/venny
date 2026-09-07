const theme = require('./theme');
const flavor = require('./flavor');
const announce = require('./announce');
const hub = require('./aisBot');

function joinDescription(json, extraLines = []) {
  const body = json?.description || '';
  const extras = extraLines.filter(line => line && line !== body);
  return [body, ...extras].filter(Boolean).join('\n\n');
}

function pack(kind, json, {
  fields,
  thumbnail,
  url,
  footer,
  timestamp,
  extraLines = [],
  job,
  facts,
  fallbackTitle,
  fallbackDescription,
} = {}) {
  return {
    json: { ...json, job: job || json.job || null, facts: facts || json.facts || {} },
    embed: theme.fromJson(kind, { ...json, description: joinDescription(json, extraLines) }, {
      fields,
      thumbnail,
      url,
      footer,
      timestamp,
    }),
    flavor: {
      kind,
      job,
      facts,
      fallbackTitle,
      fallbackDescription,
      fields,
      thumbnail,
      url,
      footer,
      timestamp,
      extraLines,
    },
  };
}

function venny(kind, opts = {}) {
  const json = opts.job
    ? flavor.venny(opts.job, opts.facts || {}, {
        fallbackTitle: opts.fallbackTitle,
        fallbackDescription: opts.fallbackDescription,
      })
    : {
        title: opts.fallbackTitle || '',
        description: opts.fallbackDescription || '',
        source: 'venny',
      };
  return pack(kind, json, opts);
}

async function make(kind, opts = {}) {
  try {
    const json = opts.job
      ? await flavor.announce(opts.job, opts.facts || {}, {
          fallbackTitle: opts.fallbackTitle,
          fallbackDescription: opts.fallbackDescription,
        })
      : {
          title: opts.fallbackTitle || '',
          description: opts.fallbackDescription || '',
          source: 'none',
        };
    return pack(kind, json, opts);
  } catch (err) {
    console.warn(`cards.make: ${err.message}`);
    return venny(kind, opts);
  }
}

async function flavorLater(message, spec, extras) {
  if (!spec?.kind || !spec?.job) return;
  const targets = [message, ...(Array.isArray(extras) ? extras : extras ? [extras] : [])]
    .filter(m => m && typeof m.edit === 'function');
  if (!targets.length) return;
  try {
    const json = await flavor.announce(spec.job, spec.facts || {}, {
      fallbackTitle: spec.fallbackTitle,
      fallbackDescription: spec.fallbackDescription,
    });
    if (json.source !== 'xai') return;
    const embeds = [theme.fromJson(spec.kind, {
      ...json,
      description: joinDescription(json, spec.extraLines || []),
    }, {
      fields: spec.fields,
      thumbnail: spec.thumbnail,
      url: spec.url,
      footer: spec.footer,
      timestamp: spec.timestamp,
    })];
    for (const m of targets) {
      await m.edit({ embeds }).catch(err => console.warn(`flavor edit: ${err.message}`));
    }
  } catch (err) {
    console.warn(`flavor edit: ${err.message}`);
  }
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
    const type = hub.typeFromJob(kind, json.job || event);
    hub.emit(type, {
      type,
      guild_id: guildId,
      kind,
      title: json.title || null,
      description: face.description || json.description || null,
      source: json.source || null,
      jump: announce.jumpUrl(guildId, posted.channelId, posted.id),
      facts: json.facts || {},
      ts: new Date().toISOString(),
    });
  }
  return posted;
}

module.exports = { make, venny, flavorLater, publish, joinDescription };
