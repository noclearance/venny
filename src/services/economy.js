const { getDb } = require('../db/database');

const REWARDS = {
  event_rsvp: 5,
  raffle_enter: 2,
  raffle_win: 25,
  sotw_win: 50,
  bingo_tile: 15,
  achievement: 20,
  goal: 10,
};

const REWARD_COPY = {
  event_rsvp: 'hitting Going (once)',
  raffle_enter: 'entering',
  raffle_win: 'winning',
  sotw_win: 'first place when the week ends',
  bingo_tile: 'each stamped bingo tile',
  achievement: 'a new 99 or pet flag',
  goal: 'hitting a personal goal',
};

function coins(reason) {
  return REWARDS[reason] || 0;
}

function payRates(...reasons) {
  return reasons.map(reason => {
    const n = REWARDS[reason];
    const why = REWARD_COPY[reason];
    return n && why ? `**${n}** credits — ${why}` : null;
  }).filter(Boolean).join('\n');
}

function payNote(...reasons) {
  const lines = payRates(...reasons);
  if (!lines) return '';
  return `${lines}\nCheck yours with \`/economy balance\`.`;
}

function getBalance(guildId, userId) {
  const db = getDb();
  const row = db.prepare('SELECT coins FROM economy_balances WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  return row?.coins || 0;
}

function award(guildId, userId, reason, amount = REWARDS[reason] || 0) {
  if (!guildId || !userId || !amount) return getBalance(guildId, userId);
  const db = getDb();
  db.prepare(`
    INSERT INTO economy_balances (guild_id, user_id, coins) VALUES (?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET coins = coins + excluded.coins
  `).run(guildId, userId, amount);
  db.prepare('INSERT INTO economy_ledger (guild_id, user_id, amount, reason) VALUES (?, ?, ?, ?)').run(guildId, userId, amount, reason);
  return getBalance(guildId, userId);
}

function leaderboard(guildId, limit = 15) {
  const db = getDb();
  return db.prepare('SELECT user_id, coins FROM economy_balances WHERE guild_id = ? AND coins > 0 ORDER BY coins DESC LIMIT ?').all(guildId, limit);
}

module.exports = { REWARDS, REWARD_COPY, coins, payRates, payNote, getBalance, award, leaderboard };
