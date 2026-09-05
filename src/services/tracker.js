const { getDb } = require('../db/database');
const achievements = require('./achievements');
const goals = require('./goals');
const bingo = require('./bingo');
const live = require('./live');
const {
  resolveConfiguredChannel,
  clearConfiguredSlot,
  isMissingDiscordChannel,
} = require('./channelRouting');

let lastId = 0;
let lastLive = 0;

async function tickTracker(client) {
  const db = getDb();
  let member = await db.prepare('SELECT * FROM members WHERE id > ? ORDER BY id ASC LIMIT 1').get(lastId);
  if (!member) {
    lastId = 0;
    member = await db.prepare('SELECT * FROM members WHERE id > ? ORDER BY id ASC LIMIT 1').get(0);
  }
  if (member) {
    lastId = member.id;
    try {
      const { fresh } = await achievements.scanMember(member.guild_id, member, client);
      await achievements.announce(client, member.guild_id, fresh, member.user_id);
    } catch (err) {
      console.error(`Achievement scan ${member.rsn}:`, err.message);
    }
    try {
      await goals.checkMember(client, member.guild_id, member);
    } catch (err) {
      console.error(`Goal check ${member.rsn}:`, err.message);
    }

    const card = await bingo.activeBingo(member.guild_id);
    if (card && card.status === 'active') {
      let announceRoute = null;
      try {
        const done = await bingo.autoCheckMember(card, member, client);
        if (done.length) {
          const channel = card.channel_id
            ? await client.channels.fetch(card.channel_id)
            : ((announceRoute = await resolveConfiguredChannel(client, member.guild_id, {
                slots: ['announce_channel'],
                allowFallback: false,
              }))?.channel || null);
          if (channel) {
            await channel.send(`🟩 <@${member.user_id}> stamped **${done.map(t => t.label).join(', ')}** on **${card.title}**.`);
          }
        }
      } catch (err) {
        if (announceRoute?.slot && isMissingDiscordChannel(err)) {
          await clearConfiguredSlot(member.guild_id, announceRoute.slot);
        }
        console.error(`Bingo check ${member.rsn}:`, err.message);
      }
    }
  }

  if (Date.now() - lastLive > 5 * 60 * 1000) {
    lastLive = Date.now();
    await live.refreshAll(client);
  }
}

module.exports = { tickTracker };
