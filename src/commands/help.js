const { SlashCommandBuilder } = require('discord.js');
const theme = require('../services/theme');
const { getDb } = require('../db/database');
const { isAdmin, isModerator } = require('../services/permissions');
const { missingChannelSlots } = require('./config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('What each command is for'),

  async execute(interaction) {
    const settings = await getDb().prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(interaction.guildId);
    const missing = missingChannelSlots(settings || {});
    const fields = [
      theme.field('Skill of the Week (WOM)', [
        '`/sotw current` — Discord week vs WOM',
        '`/sotw standings` `/me` — XP board',
        '`/sotw update` — attach or refresh WOM',
        '`/vote sotw` — poll, then it can auto-start on WOM',
      ].join('\n')),
      theme.field('Masses (calendar)', [
        '`/event create` — ToB, hangout, RSVP, 15-min ping',
        '`/event list` `/remind` `/cancel`',
        '`/subscribe add` — pings for a category',
      ].join('\n')),
      theme.field('Boss of the Week', [
        '`/vote botw` — pick the boss (can auto-start the hunt)',
        '`/boss week` — start or show the live hunt (WOM KC, not a mass)',
        '`/boss kc` period This BOTW — hunt window. Day/Week/Month stay WOM rolling.',
        '`/boss end` — close the hunt and pay first place',
      ].join('\n')),
      theme.field('Raffle / bingo', '`/raffle create` `/draw` `/end`\n`/bingo create` `/start` · Claim a tile'),
      theme.field('Lookups', '`/member link` `/clan info` `/leaderboard` `/profile card` `/economy balance`'),
    ];

    if (isAdmin(interaction.member) || isModerator(interaction.member)) {
      const staff = [
        '`/sotw start` `/end` `/cancel`',
        '`/vote cancel`',
        '`/raffle create` needs **hours** (or `until`)',
      ];
      if (isAdmin(interaction.member)) {
        if (missing.length) {
          staff.unshift(`Finish setup: ${missing.map(s => `\`/config ${s.sub}\``).join(' · ')}`);
        } else {
          staff.unshift('`/config view` — channel setup commands stay hidden until you `/config clear-channel`');
        }
      }
      fields.push(theme.field('Staff', staff.join('\n')));
    }

    const embed = theme.embed('info', {
      title: 'Venny — command book',
      description: 'SOTW is a Wise Old Man week. BOTW is a KC hunt. Events are masses on the calendar. They are not the same.',
      fields,
    });

    await interaction.reply({ embeds: [embed], flags: 64 });
  },
};
