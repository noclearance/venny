const { getDb } = require('../db/database');
const wom = require('./wom');
const theme = require('./theme');
const sotwQueue = require('./sotwQueue');

function textOf(message) {
  const mention = new RegExp(`<@!?${message.client.user.id}>`, 'g');
  return (message.content || '').replace(mention, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function looksLike(text, words) {
  return words.some(word => text.includes(word));
}

async function snapshot(guildId) {
  const db = getDb();
  const now = new Date().toISOString();
  return {
    sotw: await db.prepare('SELECT * FROM sotw WHERE guild_id = ? AND ended = 0 ORDER BY id DESC').get(guildId),
    event: await db.prepare('SELECT * FROM events WHERE guild_id = ? AND event_time > ? ORDER BY event_time ASC').get(guildId, now),
    raffle: await db.prepare('SELECT * FROM raffles WHERE guild_id = ? AND drawn = 0 ORDER BY id DESC').get(guildId),
    queue: await sotwQueue.getQueue(guildId),
    bingo: await require('./bingo').activeBingo(guildId),
  };
}

async function answerMention(message) {
  if (!message.guildId || message.author.bot) return;
  if (!message.mentions.has(message.client.user)) return;

  const asked = textOf(message);
  const data = await snapshot(message.guildId);

  if (looksLike(asked, ['sotw', 'skill of the week', 'standings', 'winning', 'who is first'])) {
    if (!data.sotw) {
      return message.reply({ embeds: [theme.embed('sotw', { title: 'SOTW', description: theme.EMPTY.sotw })] });
    }
    const end = theme.when(data.sotw.ends_at);
    return message.reply({
      embeds: [theme.embed('sotw', {
        title: `${data.sotw.skill} SOTW`,
        description: `${theme.line('sotwOpen', data.sotw.id)}\nEnds ${end}\n\`/sotw standings\` or \`/sotw me\``,
        thumbnail: theme.skillIconUrl(data.sotw.skill),
      })],
    });
  }

  if (looksLike(asked, ['event', 'mass', 'when', 'next', 'raid', 'boss'])) {
    if (!data.event) {
      return message.reply({ embeds: [theme.embed('event', { title: 'Events', description: theme.EMPTY.events })] });
    }
    return message.reply({
      embeds: [theme.embed('event', {
        title: data.event.title,
        description: [
          data.event.description || theme.line('eventPosted', data.event.id),
          theme.when(data.event.event_time),
        ].join('\n'),
      })],
    });
  }

  if (looksLike(asked, ['bingo'])) {
    const card = data.bingo || await require('./bingo').activeBingo(message.guildId);
    if (!card) {
      return message.reply({ embeds: [theme.embed('raffle', { title: 'Bingo', description: 'No board running. A mod can `/bingo create`.' })] });
    }
    return message.reply({ embeds: [await require('./bingo').boardEmbed(card)] });
  }

  if (looksLike(asked, ['raffle', 'giveaway'])) {
    if (!data.raffle) {
      return message.reply({ embeds: [theme.embed('raffle', { title: 'Raffle', description: theme.EMPTY.raffles })] });
    }
    return message.reply({
      embeds: [theme.embed('raffle', {
        title: data.raffle.title,
        description: `${theme.line('raffleOpen', data.raffle.id)}\n#${data.raffle.id}`,
      })],
    });
  }

  if (looksLike(asked, ['help', 'command', 'what can', 'who are'])) {
    return message.reply({
      embeds: [theme.embed('info', {
        title: 'Venny',
        description: theme.line('mentionHelp', message.author.id),
        thumbnail: theme.VENNY.icon,
      })],
    });
  }

  const lines = [];
  if (data.sotw) lines.push(`**SOTW** — ${data.sotw.skill}\n${theme.when(data.sotw.ends_at)}`);
  else lines.push('**SOTW** — nothing running.');
  if (data.event) lines.push(`**Next mass** — ${data.event.title}\n${theme.when(data.event.event_time)}`);
  else lines.push('**Next mass** — calendar’s empty.');
  if (data.raffle) lines.push(`**Raffle** — ${data.raffle.title}`);
  if (data.bingo) lines.push(`**Bingo** — ${data.bingo.title} (${data.bingo.status})`);
  if (data.queue.length) {
    lines.push(`**Queued** — ${data.queue.map(q => `${wom.getSkillEmoji(q.skill)} ${q.skill}`).join(', ')}`);
  }

  return message.reply({
    embeds: [theme.embed('brand', {
      title: 'You pinged me. Here’s the board.',
      description: lines.join('\n\n'),
      thumbnail: data.sotw ? theme.skillIconUrl(data.sotw.skill) : theme.VENNY.icon,
    })],
  });
}

module.exports = { answerMention };
