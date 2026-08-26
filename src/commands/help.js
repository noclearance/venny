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
      theme.field('You', [
        '`/me link` — RSN',
        '`/me profile` · `/me balance`',
        '`/me goals list`',
      ].join('\n')),
      theme.field('Clan board', [
        '`/clan info` — what’s live',
        '`/clan hiscores` · `/clan gained`',
        '`/clan members` · `/clan achievements`',
      ].join('\n')),
      theme.field('Skill of the Week', [
        '`/sotw current` · `/sotw standings` · `/sotw me`',
        '`/sotw start` optional **prize**',
        '`/sotw prize` — stamp loot on a week already live (does not restart)',
      ].join('\n')),
      theme.field('Boss of the Week', [
        '`/boss week` — hunt (optional **prize**)',
        '`/boss kc` — this BOTW or rolling WOM',
        '`/boss end` — close and pay first place',
      ].join('\n')),
      theme.field('Masses', [
        '`/event create` — **about** is required',
        '`@Venny make an event` — staff get a form',
        '`/event list` · `/subscribe add`',
      ].join('\n')),
      theme.field('Raffle / bingo', [
        '`/raffle create prize:` · `/draw` · `/end`',
        '`/bingo create` · `/start` · claim a tile',
      ].join('\n')),
    ];

    if (isAdmin(interaction.member) || isModerator(interaction.member)) {
      const staff = [
        '`/sotw start` · `/end` · `/cancel`',
        '`/vote sotw` · `/vote botw` (admins — not on the member / list)',
        '`/raffle create` needs **hours** (or `until`)',
      ];
      if (isAdmin(interaction.member)) {
        staff.push('`/config ranks` — Trial/Member/Veteran/Officer/Admin + Venny’s height');
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
      description: [
        'Type `/` — members see a short list. Staff tools stay off that list.',
        'SOTW is a Wise Old Man week. BOTW is a KC hunt. Events are masses. They are not the same.',
      ].join('\n\n'),
      fields,
    });

    await interaction.reply({ embeds: [embed], flags: 64 });
  },
};
