const { SlashCommandBuilder, PollLayoutType } = require('discord.js');
const { getDb } = require('../db/database');
const wom = require('../services/wom');
const { SKILL_CHOICES } = wom;
const { isAdmin } = require('../services/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vote')
    .setDescription('Create a native Discord poll for clan voting')
    .addSubcommand(sub =>
      sub.setName('sotw')
        .setDescription('Poll for the next Skill of the Week')
        .addBooleanOption(opt => opt.setName('random').setDescription('Yes = I pick the skills. No = you pick them below.').setRequired(true))
        .addIntegerOption(opt => opt.setName('how_many').setDescription('If random: how many skills (default 6)').setMinValue(3).setMaxValue(10))
        .addStringOption(opt => opt.setName('skill_1').setDescription('If not random: first skill').addChoices(...SKILL_CHOICES))
        .addStringOption(opt => opt.setName('skill_2').setDescription('If not random: second skill').addChoices(...SKILL_CHOICES))
        .addStringOption(opt => opt.setName('skill_3').setDescription('Optional extra skill').addChoices(...SKILL_CHOICES))
        .addStringOption(opt => opt.setName('skill_4').setDescription('Optional extra skill').addChoices(...SKILL_CHOICES))
        .addStringOption(opt => opt.setName('skill_5').setDescription('Optional extra skill').addChoices(...SKILL_CHOICES))
        .addStringOption(opt => opt.setName('skill_6').setDescription('Optional extra skill').addChoices(...SKILL_CHOICES))
        .addStringOption(opt => opt.setName('skill_7').setDescription('Optional extra skill').addChoices(...SKILL_CHOICES))
        .addStringOption(opt => opt.setName('skill_8').setDescription('Optional extra skill').addChoices(...SKILL_CHOICES))
        .addStringOption(opt => opt.setName('skill_9').setDescription('Optional extra skill').addChoices(...SKILL_CHOICES))
        .addStringOption(opt => opt.setName('skill_10').setDescription('Optional extra skill').addChoices(...SKILL_CHOICES))
        .addIntegerOption(opt => opt.setName('duration_hours').setDescription('How long people can vote (default 24 hours)').setMinValue(1).setMaxValue(168))
        .addIntegerOption(opt => opt.setName('sotw_duration_days').setDescription('If it starts on WOM, how many days the week lasts').setMinValue(1).setMaxValue(30))
        .addBooleanOption(opt => opt.setName('also_start_on_wom').setDescription('When votes close, start that skill on Wise Old Man and the calendar')))
    .addSubcommand(sub =>
      sub.setName('botw')
        .setDescription('Poll for the next Boss of the Week')
        .addBooleanOption(opt => opt.setName('random').setDescription('Yes = I pick the bosses. No = you pick them below.').setRequired(true))
        .addIntegerOption(opt => opt.setName('how_many').setDescription('If random: how many bosses (default 6)').setMinValue(3).setMaxValue(10))
        .addStringOption(opt => opt.setName('boss_1').setDescription('If not random: first boss').setAutocomplete(true))
        .addStringOption(opt => opt.setName('boss_2').setDescription('If not random: second boss').setAutocomplete(true))
        .addStringOption(opt => opt.setName('boss_3').setDescription('Optional extra boss').setAutocomplete(true))
        .addStringOption(opt => opt.setName('boss_4').setDescription('Optional extra boss').setAutocomplete(true))
        .addStringOption(opt => opt.setName('boss_5').setDescription('Optional extra boss').setAutocomplete(true))
        .addStringOption(opt => opt.setName('boss_6').setDescription('Optional extra boss').setAutocomplete(true))
        .addStringOption(opt => opt.setName('boss_7').setDescription('Optional extra boss').setAutocomplete(true))
        .addStringOption(opt => opt.setName('boss_8').setDescription('Optional extra boss').setAutocomplete(true))
        .addStringOption(opt => opt.setName('boss_9').setDescription('Optional extra boss').setAutocomplete(true))
        .addStringOption(opt => opt.setName('boss_10').setDescription('Optional extra boss').setAutocomplete(true))
        .addIntegerOption(opt => opt.setName('duration_hours').setDescription('How long the poll runs (default: 24 hours)').setMinValue(1).setMaxValue(168)))
    .addSubcommand(sub =>
      sub.setName('generic')
        .setDescription('Create a generic poll with up to 10 options')
        .addStringOption(opt => opt.setName('question').setDescription('Poll question').setRequired(true))
        .addStringOption(opt => opt.setName('option_1').setDescription('Option 1').setRequired(true))
        .addStringOption(opt => opt.setName('option_2').setDescription('Option 2').setRequired(true))
        .addStringOption(opt => opt.setName('option_3').setDescription('Option 3').setRequired(false))
        .addStringOption(opt => opt.setName('option_4').setDescription('Option 4').setRequired(false))
        .addStringOption(opt => opt.setName('option_5').setDescription('Option 5').setRequired(false))
        .addStringOption(opt => opt.setName('option_6').setDescription('Option 6').setRequired(false))
        .addStringOption(opt => opt.setName('option_7').setDescription('Option 7').setRequired(false))
        .addStringOption(opt => opt.setName('option_8').setDescription('Option 8').setRequired(false))
        .addStringOption(opt => opt.setName('option_9').setDescription('Option 9').setRequired(false))
        .addStringOption(opt => opt.setName('option_10').setDescription('Option 10').setRequired(false))
        .addIntegerOption(opt => opt.setName('duration_hours').setDescription('How long the poll runs (default: 24 hours)').setRequired(false).setMinValue(1).setMaxValue(168)))
    .addSubcommand(sub =>
      sub.setName('results')
        .setDescription('Show the results of a poll')
        .addIntegerOption(opt => opt.setName('id').setDescription('Poll ID').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List recent polls in this server'))
    .addSubcommand(sub =>
      sub.setName('cancel')
        .setDescription('Stop a running poll so it will not start SOTW on Wise Old Man')
        .addIntegerOption(opt => opt.setName('id').setDescription('Poll number from /vote list').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const db = getDb();

    const createSubs = ['sotw', 'botw', 'generic', 'cancel'];
    if (createSubs.includes(sub) && !isAdmin(interaction.member)) {
      return interaction.reply({ content: 'Admins run the votes. Use `/vote results` or `/vote list` to look.', flags: 64 });
    }

    if (sub === 'cancel') {
      const id = interaction.options.getInteger('id');
      const poll = await db.prepare('SELECT * FROM polls WHERE id = ? AND guild_id = ?').get(id, interaction.guildId);
      if (!poll) return interaction.reply({ content: `No poll #${id}.`, flags: 64 });
      if (poll.finalized) return interaction.reply({ content: `Poll #${id} already closed (${poll.winner || 'done'}).`, flags: 64 });
      await db.prepare("UPDATE polls SET finalized = 1, auto_start = 0, winner = ? WHERE id = ?").run('Cancelled', id);
      try {
        const channel = await interaction.client.channels.fetch(poll.channel_id);
        const message = await channel.messages.fetch(poll.message_id);
        if (message.poll?.end) await message.poll.end().catch(() => {});
      } catch { /* poll message may already be gone */ }
      return interaction.reply({
        content: `Poll **#${id}** is cancelled. It will not start a SOTW or update Wise Old Man.`,
        flags: 64,
      });
    }

    if (sub === 'sotw') {
      const random = interaction.options.getBoolean('random');
      let uniqueSkills;
      if (random) {
        uniqueSkills = await rollSkills(interaction.guildId, interaction.options.getInteger('how_many') || 6);
      } else {
        const skills = [];
        for (let i = 1; i <= 10; i++) {
          const s = interaction.options.getString(`skill_${i}`);
          if (s) skills.push(s);
        }
        uniqueSkills = [...new Set(skills)];
      }
      if (uniqueSkills.length < 2) {
        return interaction.reply({
          content: random
            ? 'Could not roll enough skills. Try again.'
            : 'Turn **random** off and pick at least two skills, or turn it on and I will pick them.',
          flags: 64,
        });
      }
      await postSotwPoll(interaction, db, uniqueSkills, { rolled: random });
      return;
    }

    if (sub === 'botw') {
      const random = interaction.options.getBoolean('random');
      let uniqueBosses;
      if (random) {
        uniqueBosses = await rollBosses(interaction.guildId, interaction.options.getInteger('how_many') || 6);
      } else {
        const bosses = [];
        for (let i = 1; i <= 10; i++) {
          const b = interaction.options.getString(`boss_${i}`);
          if (b) bosses.push(b.trim());
        }
        uniqueBosses = [...new Set(bosses)];
      }
      if (uniqueBosses.length < 2) {
        return interaction.reply({
          content: random
            ? 'Could not roll enough bosses. Try again.'
            : 'Turn **random** off and pick at least two bosses, or turn it on and I will pick them.',
          flags: 64,
        });
      }
      await postBotwPoll(interaction, db, uniqueBosses, { rolled: random });
      return;
    }

    // ── Generic Poll ─────────────────────────
    if (sub === 'generic') {
      const question = interaction.options.getString('question');
      const options = [];
      for (let i = 1; i <= 10; i++) {
        const o = interaction.options.getString(`option_${i}`);
        if (o) options.push(o);
      }

      const uniqueOptions = [...new Set(options)];
      if (uniqueOptions.length < 2) {
        return interaction.reply({ content: '❌ You need at least 2 different options.', flags: 64 });
      }

      const durationHours = interaction.options.getInteger('duration_hours') || 24;
      const endsAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);
      const theme = require('../services/theme');

      const card = await require('../services/flavor').write({
        job: 'vote_generic',
        facts: { question },
        fallbackTitle: 'Clan vote',
        fallbackDescription: 'One vote. Hit the poll under this card.',
      });

      const pollMsg = await postAnnouncedPoll(interaction, {
        embed: theme.embed('poll', {
          title: card.title,
          description: [
            card.description,
            question,
          ].join('\n\n'),
          fields: [
            theme.field('Closes', theme.when(endsAt.toISOString()), true),
          ],
        }),
        poll: {
          question: { text: question.slice(0, 300) },
          answers: uniqueOptions.map(o => ({ text: o })),
          duration: durationHours,
          allowMultiselect: false,
          layoutType: PollLayoutType.Default,
        },
      });

      const result = await db.prepare(`
        INSERT INTO polls (guild_id, type, question, channel_id, message_id, options_json, ends_at, auto_start, created_by)
        VALUES (?, 'generic', ?, ?, ?, ?, ?, 0, ?)
      `).run(interaction.guildId, question, interaction.channelId, pollMsg.id, JSON.stringify(uniqueOptions), endsAt.toISOString(), interaction.user.id);

      await require('../services/announce').broadcast(interaction.client, interaction.guildId, {
        kind: 'poll',
        title: card.title,
        description: `${card.description}\n\n${question}`,
        fields: [theme.field('Closes', theme.when(endsAt.toISOString()), true)],
        sourceChannelId: pollMsg.channelId,
        sourceMessageId: pollMsg.id,
      });

      await interaction.followUp({
        content: `Poll **#${result.lastInsertRowid}**. Stop it with \`/vote cancel id:${result.lastInsertRowid}\`.`,
        flags: 64,
      });
      return;
    }

    // ── Results ──────────────────────────────
    if (sub === 'results') {
      const id = interaction.options.getInteger('id');
      const poll = await db.prepare('SELECT * FROM polls WHERE id = ? AND guild_id = ?').get(id, interaction.guildId);

      if (!poll) {
        return interaction.reply({ content: `❌ Poll #${id} not found.`, flags: 64 });
      }

      await interaction.deferReply({ flags: 64 });

      try {
        const channel = await interaction.client.channels.fetch(poll.channel_id);
        const message = await channel.messages.fetch(poll.message_id);

        if (!message.poll) {
          return interaction.editReply('❌ Could not find the poll on that message.');
        }

        const answers = message.poll.answers;
        const sorted = [...answers.values()].sort((a, b) => b.voteCount - a.voteCount);

        let response = `📊 **Poll Results: ${poll.question}**\n\n`;
        sorted.forEach((answer, i) => {
          const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
          response += `${medal} ${answer.text} — **${answer.voteCount} votes**\n`;
        });

        if (poll.finalized && poll.winner) {
          response += `\n✅ Winner: **${poll.winner}**`;
          if (poll.type === 'sotw' && poll.auto_start) {
            response += ` — SOTW was auto-started!`;
          }
        }

        await interaction.editReply(response);
      } catch (err) {
        await interaction.editReply(`❌ Failed to fetch poll results: ${err.message}`);
      }
      return;
    }

    // ── List ─────────────────────────────────
    if (sub === 'list') {
      const polls = await db.prepare('SELECT * FROM polls WHERE guild_id = ? ORDER BY id DESC LIMIT 15').all(interaction.guildId);

      if (polls.length === 0) {
        return interaction.reply({ content: 'No polls yet. Create one with `/vote sotw`, `/vote botw`, or `/vote generic`!', flags: 64 });
      }

      const list = polls.map(p => {
        const typeLabel = p.type === 'sotw' ? '🏆 SOTW' : p.type === 'botw' ? '⚔️ BOTW' : '📊 Generic';
        const status = p.finalized ? `✅ Winner: ${p.winner}` : '🟢 Active';
        return `**#${p.id}** ${typeLabel} — ${status}`;
      }).join('\n');

      await interaction.reply({ content: `**Recent Polls:**\n\n${list}`, flags: 64 });
      return;
    }
  },
  adminSubs: ['sotw', 'botw', 'generic', 'cancel'],
  publicSubs: ['sotw', 'botw', 'generic'],

  async autocomplete(interaction) {
    const { filterChoices, respond } = require('../services/autocomplete');
    const { BOSSES, prettyMetric } = require('../osrs/catalog');
    const focused = interaction.options.getFocused(true);
    if (focused.name.startsWith('boss_')) {
      return respond(interaction, filterChoices(BOSSES, focused.value, b => ({
        name: prettyMetric(b),
        value: prettyMetric(b),
      })));
    }
    return respond(interaction, []);
  },
};

// Combat pile — people do not want these on a random SOTW ballot.
const SKIP_RANDOM = new Set(['overall', 'attack', 'strength', 'defence', 'hitpoints']);

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function rollSkills(guildId, count) {
  const pool = wom.SKILLS.filter(s => !SKIP_RANDOM.has(s));
  const recent = (await getDb().prepare(`
    SELECT DISTINCT lower(skill) as skill FROM sotw_winners
    WHERE guild_id = ? ORDER BY id DESC LIMIT 8
  `).all(guildId)).map(r => r.skill);
  let candidates = pool.filter(s => !recent.includes(s));
  if (candidates.length < count) candidates = [...pool];
  return shuffle(candidates).slice(0, count);
}

// Clan-week bosses from /boss — not Wintertodt, not giants, not every wildy filler.
async function rollBosses(guildId, count) {
  const { BOSS_CHOICES, prettyMetric } = require('../osrs/catalog');
  const pool = BOSS_CHOICES.map(c => c.value);
  const recentRows = await getDb().prepare(`
    SELECT DISTINCT lower(boss) as boss FROM botw
    WHERE guild_id = ? ORDER BY id DESC LIMIT 8
  `).all(guildId);
  const pollRows = await getDb().prepare(`
    SELECT winner FROM polls
    WHERE guild_id = ? AND type = 'botw' AND finalized = 1 AND winner IS NOT NULL
    ORDER BY id DESC LIMIT 8
  `).all(guildId);
  const recent = new Set([
    ...recentRows.map(r => r.boss),
    ...pollRows.map(r => String(r.winner || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')),
  ]);
  let candidates = pool.filter(b => !recent.has(b));
  if (candidates.length < count) candidates = [...pool];
  return shuffle(candidates).slice(0, count).map(prettyMetric);
}

async function postAnnouncedPoll(interaction, { embed, poll }) {
  await interaction.reply({ embeds: [embed] });
  return interaction.followUp({
    content: 'Vote on this one.',
    poll,
  });
}

async function postBotwPoll(interaction, db, uniqueBosses, { rolled } = {}) {
  const theme = require('../services/theme');
  const durationHours = interaction.options.getInteger('duration_hours') || 24;
  const endsAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);
  const questionText = rolled
    ? 'Vote BOTW — I rolled these'
    : 'Vote for the next Boss of the Week';

  const card = await require('../services/flavor').write({
    job: 'vote_botw',
    facts: { rolled: Boolean(rolled), bosses: uniqueBosses },
    fallbackTitle: 'Boss of the Week',
    fallbackDescription: [
      'One vote. Pick the boss for next week.',
      rolled ? theme.line('voteRoll', Date.now()) : null,
    ].filter(Boolean).join('\n\n'),
  });

  const pollMsg = await postAnnouncedPoll(interaction, {
    embed: theme.embed('poll', {
      title: card.title,
      description: [
        card.description,
        'Winner is whoever the clan picks. After it closes, a mod starts it with `/boss week`. I do not auto-track KC off this poll yet.',
      ].filter(Boolean).join('\n\n'),
      fields: [
        theme.field('Closes', theme.when(endsAt.toISOString()), true),
        theme.field(rolled ? 'I rolled' : 'On the ballot', uniqueBosses.join('\n')),
      ],
    }),
    poll: {
      question: { text: questionText.slice(0, 300) },
      answers: uniqueBosses.map(b => ({ text: String(b).slice(0, 55) })),
      duration: durationHours,
      allowMultiselect: false,
      layoutType: PollLayoutType.Default,
    },
  });

  const result = await db.prepare(`
    INSERT INTO polls (guild_id, type, question, channel_id, message_id, options_json, ends_at, auto_start, created_by)
    VALUES (?, 'botw', ?, ?, ?, ?, ?, 0, ?)
  `).run(interaction.guildId, questionText, interaction.channelId, pollMsg.id, JSON.stringify(uniqueBosses), endsAt.toISOString(), interaction.user.id);

  await require('../services/announce').broadcast(interaction.client, interaction.guildId, {
    kind: 'poll',
    title: card.title,
    description: card.description,
    fields: [
      theme.field('Closes', theme.when(endsAt.toISOString()), true),
      theme.field(rolled ? 'I rolled' : 'On the ballot', uniqueBosses.join('\n')),
    ],
    sourceChannelId: pollMsg.channelId,
    sourceMessageId: pollMsg.id,
  });

  await interaction.followUp({
    content: `Poll **#${result.lastInsertRowid}**. Stop it with \`/vote cancel id:${result.lastInsertRowid}\`.`,
    flags: 64,
  });
}

async function postSotwPoll(interaction, db, uniqueSkills, { rolled } = {}) {
  const theme = require('../services/theme');
  const economy = require('../services/economy');
  const durationHours = interaction.options.getInteger('duration_hours') || 24;
  const sotwDuration = interaction.options.getInteger('sotw_duration_days') || 7;
  const autoStart = interaction.options.getBoolean('also_start_on_wom') !== false;
  const endsAtDate = new Date(Date.now() + durationHours * 60 * 60 * 1000);
  const endsAt = endsAtDate.toISOString();

  const labels = uniqueSkills.map(s => `${wom.getSkillEmoji(s)} ${s.charAt(0).toUpperCase() + s.slice(1)}`);
  const questionText = rolled
    ? 'Vote SOTW — I rolled these'
    : 'Vote for the next Skill of the Week';

  const card = await require('../services/flavor').write({
    job: 'vote_sotw',
    facts: { rolled: Boolean(rolled), skills: uniqueSkills, autoStart, days: sotwDuration },
    fallbackTitle: 'Skill of the Week',
    fallbackDescription: [
      'One vote. Pick the skill for the next week.',
      rolled ? theme.line('voteRoll', Date.now()) : null,
    ].filter(Boolean).join('\n\n'),
  });

  const pollMsg = await postAnnouncedPoll(interaction, {
    embed: theme.embed('sotw', {
      title: card.title,
      description: [
        card.description,
        autoStart
          ? `Winner goes on Wise Old Man and the clan calendar for **${sotwDuration} days**. Gains count from that moment. \`/sotw me\` after it starts.`
          : 'Votes only — this will not start a week on Wise Old Man.',
      ].filter(Boolean).join('\n\n'),
      fields: [
        theme.field('Closes', theme.when(endsAt), true),
        theme.field('Week', `${sotwDuration} days`, true),
        theme.field(rolled ? 'I rolled' : 'On the ballot', labels.join('\n')),
        theme.field('Guild credits', economy.payNote('sotw_win')),
      ],
    }),
    poll: {
      question: { text: questionText.slice(0, 300) },
      answers: labels.map(text => ({ text: text.slice(0, 55) })),
      duration: durationHours,
      allowMultiselect: false,
      layoutType: PollLayoutType.Default,
    },
  });

  const result = await db.prepare(`
    INSERT INTO polls (guild_id, type, question, channel_id, message_id, options_json, ends_at, auto_start, sotw_duration, created_by)
    VALUES (?, 'sotw', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    interaction.guildId,
    questionText,
    interaction.channelId,
    pollMsg.id,
    JSON.stringify(uniqueSkills),
    endsAt,
    autoStart ? 1 : 0,
    sotwDuration,
    interaction.user.id
  );

  await require('../services/announce').broadcast(interaction.client, interaction.guildId, {
    kind: 'sotw',
    title: card.title,
    description: [
      card.description,
      autoStart
        ? `Winner goes on Wise Old Man and the calendar for **${sotwDuration} days**.`
        : 'Votes only — will not start a week on Wise Old Man.',
    ].filter(Boolean).join('\n\n'),
    fields: [
      theme.field('Closes', theme.when(endsAt), true),
      theme.field('Guild credits', economy.payNote('sotw_win')),
    ],
    sourceChannelId: pollMsg.channelId,
    sourceMessageId: pollMsg.id,
  });

  await interaction.followUp({
    content: `Poll **#${result.lastInsertRowid}**. Stop it with \`/vote cancel id:${result.lastInsertRowid}\`.`,
    flags: 64,
  });
}
