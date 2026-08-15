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

async function getBalance(guildId, userId) {
  const db = getDb();
  const row = await db.prepare('SELECT coins FROM economy_balances WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  return row?.coins || 0;
}

function asClient(value) {
  return value && typeof value.users?.fetch === 'function' ? value : null;
}

async function tell(client, userId, amount, reason, balance) {
  if (!client || !userId || !amount) return;
  const why = REWARD_COPY[reason] || reason;
  try {
    const user = await client.users.fetch(userId);
    if (!user || user.bot) return;
    const theme = require('./theme');
    await user.send({
      embeds: [theme.embed('success', {
        title: 'Credits',
        description: `**+${amount}** for ${why}.\nNobody else sees this.`,
        fields: [theme.field('Pouch', `**${balance.toLocaleString()}**`, true)],
        footer: '/economy balance if you want the card',
      })],
    });
  } catch {
    // DMs closed or blocked — leave it
  }
}

async function award(guildId, userId, reason, amount, client) {
  const maybeClient = asClient(amount) || asClient(client);
  const n = asClient(amount) ? (REWARDS[reason] || 0) : (amount == null ? (REWARDS[reason] || 0) : amount);
  if (!guildId || !userId || !n) return await getBalance(guildId, userId);
  const db = getDb();
  await db.prepare(`
    INSERT INTO economy_balances (guild_id, user_id, coins) VALUES (?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET coins = coins + excluded.coins
  `).run(guildId, userId, n);
  await db.prepare('INSERT INTO economy_ledger (guild_id, user_id, amount, reason) VALUES (?, ?, ?, ?)').run(guildId, userId, n, reason);
  const balance = await getBalance(guildId, userId);
  if (maybeClient) tell(maybeClient, userId, n, reason, balance);
  return balance;
}

async function leaderboard(guildId, limit = 15) {
  const db = getDb();
  return await db.prepare('SELECT user_id, coins FROM economy_balances WHERE guild_id = ? AND coins > 0 ORDER BY coins DESC LIMIT ?').all(guildId, limit);
}

module.exports = { REWARDS, REWARD_COPY, coins, payRates, payNote, getBalance, award, leaderboard };
