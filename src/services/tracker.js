const { getDb } = require('../db/database');
const achievements = require('./achievements');
const goals = require('./goals');
const bingo = require('./bingo');
const live = require('./live');

let cursor = 0;
let lastLive = 0;

async function tickTracker(client) {
  const db = getDb();
  const members = db.prepare('SELECT * FROM members ORDER BY id ASC').all();
  if (members.length) {
    const member = members[cursor % members.length];
    cursor += 1;
    try {
      const { fresh } = await achievements.scanMember(member.guild_id, member);
      await achievements.announce(client, member.guild_id, fresh, member.user_id);
    } catch (err) {
      console.error(`Achievement scan ${member.rsn}:`, err.message);
    }
    try {
      await goals.checkMember(client, member.guild_id, member);
    } catch (err) {
      console.error(`Goal check ${member.rsn}:`, err.message);
    }

    const card = bingo.activeBingo(member.guild_id);
    if (card && card.status === 'active') {
      try {
        const done = await bingo.autoCheckMember(card, member);
        if (done.length) {
          const settings = db.prepare('SELECT announce_channel, reminder_channel FROM guild_settings WHERE guild_id = ?').get(member.guild_id);
          const channelId = card.channel_id || settings?.announce_channel || settings?.reminder_channel;
          if (channelId) {
            const channel = await client.channels.fetch(channelId);
            await channel.send(`🟩 <@${member.user_id}> stamped **${done.map(t => t.label).join(', ')}** on **${card.title}**.`);
          }
        }
      } catch (err) {
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
