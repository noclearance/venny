const { getDb } = require('../db/database');
const { loadPlayer } = require('../osrs/snapshot');
const { award } = require('./economy');
const theme = require('./theme');

function addXpGoal(guildId, userId, amount) {
  return getDb().prepare(`
    INSERT INTO xp_goals (guild_id, user_id, kind, skill, target) VALUES (?, ?, 'xp', 'overall', ?)
  `).run(guildId, userId, amount).lastInsertRowid;
}

function addLevelGoal(guildId, userId, skill, level) {
  return getDb().prepare(`
    INSERT INTO xp_goals (guild_id, user_id, kind, skill, target) VALUES (?, ?, 'level', ?, ?)
  `).run(guildId, userId, skill, level).lastInsertRowid;
}

function addKcGoal(guildId, userId, boss, amount) {
  return getDb().prepare(`
    INSERT INTO xp_goals (guild_id, user_id, kind, skill, target) VALUES (?, ?, 'kc', ?, ?)
  `).run(guildId, userId, boss, amount).lastInsertRowid;
}

function listGoals(guildId, userId) {
  return getDb().prepare('SELECT * FROM xp_goals WHERE guild_id = ? AND user_id = ? AND reached = 0 ORDER BY id ASC').all(guildId, userId);
}

function clearGoals(guildId, userId) {
  return getDb().prepare('UPDATE xp_goals SET reached = 1, reached_at = datetime(\'now\') WHERE guild_id = ? AND user_id = ? AND reached = 0').run(guildId, userId).changes;
}

function currentValue(parsed, goal) {
  if (goal.kind === 'xp') return parsed.totalXp;
  if (goal.kind === 'kc') {
    const boss = parsed.bossList.find(b => b.name === goal.skill);
    return boss?.kills || 0;
  }
  const skill = parsed.skillList.find(s => s.name === goal.skill) || (goal.skill === 'overall' ? { level: parsed.totalLevel } : null);
  return skill?.level || 0;
}

async function checkMember(client, guildId, member) {
  const open = listGoals(guildId, member.user_id);
  if (!open.length) return [];
  const parsed = await loadPlayer(member.rsn);
  const hit = [];
  const db = getDb();
  for (const goal of open) {
    const now = currentValue(parsed, goal);
    if (now >= goal.target) {
      db.prepare('UPDATE xp_goals SET reached = 1, reached_at = datetime(\'now\') WHERE id = ?').run(goal.id);
      award(guildId, member.user_id, 'goal');
      hit.push({ ...goal, now });
    }
  }
  if (hit.length) {
    const settings = db.prepare('SELECT announce_channel, reminder_channel FROM guild_settings WHERE guild_id = ?').get(guildId);
    const channelId = settings?.announce_channel || settings?.reminder_channel;
    if (channelId) {
      try {
        const channel = await client.channels.fetch(channelId);
        for (const goal of hit) {
          const label = goal.kind === 'xp'
            ? `${goal.target.toLocaleString()} total XP`
            : goal.kind === 'kc'
              ? `${goal.target.toLocaleString()} ${goal.skill} KC`
              : `${goal.skill} ${goal.target}`;
          await channel.send({
            content: `<@${member.user_id}>`,
            embeds: [theme.embed('success', {
              title: 'Goal hit',
              description: `${member.rsn} reached **${label}**.`,
              thumbnail: theme.skillIconUrl(goal.skill || 'overall'),
            })],
          });
        }
      } catch (err) {
        console.error('Goal ping failed:', err.message);
      }
    }
  }
  return hit;
}

module.exports = { addXpGoal, addLevelGoal, addKcGoal, listGoals, clearGoals, checkMember };
