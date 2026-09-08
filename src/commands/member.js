const { SlashCommandBuilder } = require('discord.js');
const { getDb } = require('../db/database');
const wom = require('../services/wom');
const { getPaginatedData, buildPagePayload } = require('../services/pagination');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('member')
    .setDescription('Link your Discord account to your OSRS RSN (via Wise Old Man)')
    .addSubcommand(sub =>
      sub.setName('link')
        .setDescription('Link your Discord to your OSRS RSN')
        .addStringOption(opt =>
          opt.setName('rsn')
            .setDescription('Your Old School RuneScape username')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('unlink')
        .setDescription('Remove your RSN link'))
    .addSubcommand(sub =>
      sub.setName('whois')
        .setDescription('Look up a member\'s RSN')
        .addUserOption(opt =>
          opt.setName('user')
            .setDescription('Discord user to look up')
            .setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List all linked members in this server')),

  skipRegister: true,

  async execute(interaction) {
    return this.run(interaction, interaction.options.getSubcommand());
  },

  async run(interaction, sub) {
    const db = getDb();

    if (sub === 'link') {
      const rsn = interaction.options.getString('rsn').trim();

      await interaction.deferReply({ flags: 64 });

      try {
        const details = await wom.getPlayerDetails(rsn);
        const womId = details.id;

        try {
          await db.prepare(`
            INSERT INTO members (guild_id, user_id, rsn, wom_id)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(guild_id, user_id) DO UPDATE SET rsn = ?, wom_id = ?
          `).run(interaction.guildId, interaction.user.id, details.username, womId, details.username, womId);
        } catch (err) {
          if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.code === '23505' || /UNIQUE|duplicate key/i.test(err.message)) {
            return interaction.editReply(`❌ **${details.displayName}** is already linked to another Discord account in this server.`);
          }
          throw err;
        }

        const snap = details.latestSnapshot;
        const skills = snap?.data?.skills || {};
        const overall = skills.overall || {};

        const theme = require('../services/theme');
        const embed = theme.embed('success', {
          title: `✅ Linked · ${details.displayName}`,
          url: `https://wiseoldman.net/players/${encodeURIComponent(details.username)}`,
          thumbnail: interaction.user.displayAvatarURL(),
          fields: [
            theme.field('Combat', `${details.combatLevel || '—'}`, true),
            theme.field('Total XP', `${(overall.experience || 0).toLocaleString()}`, true),
            theme.field('EHP', `${(details.ehp || 0).toFixed(1)}`, true),
            theme.field('Rank', `#${(overall.rank || 0).toLocaleString()}`, true),
            theme.field('Type', `${details.type || '—'}`, true),
            theme.field('WOM ID', `${womId}`, true),
          ],
        });

        const skillEntries = Object.entries(skills)
          .filter(([k]) => k !== 'overall')
          .sort((a, b) => (b[1].experience || 0) - (a[1].experience || 0))
          .slice(0, 6);

        if (skillEntries.length > 0) {
          const skillList = skillEntries.map(([name, data]) => {
            return `${wom.getSkillEmoji(name)} ${name.charAt(0).toUpperCase() + name.slice(1)}: **${data.level || 0}** (${(data.experience || 0).toLocaleString()} XP)`;
          }).join('\n');
          embed.addFields({ name: 'Top Skills', value: skillList });
        }

        const activeSotw = await db.prepare('SELECT * FROM sotw WHERE guild_id = ? AND ended = 0 ORDER BY id DESC').get(interaction.guildId);
        const activeBotw = await db.prepare('SELECT * FROM botw WHERE guild_id = ? AND ended = 0 ORDER BY id DESC').get(interaction.guildId);
        const settings = await db.prepare('SELECT reminder_channel FROM guild_settings WHERE guild_id = ?').get(interaction.guildId);
        const { prettyMetric } = require('../osrs/catalog');

        const liveSummary = [];
        if (activeSotw) {
          const endTs = Math.floor(new Date(activeSotw.ends_at).getTime() / 1000);
          liveSummary.push(`SOTW ${wom.getSkillEmoji(activeSotw.skill)} **${activeSotw.skill.toUpperCase()}** (ends <t:${endTs}:R>)`);
        }
        if (activeBotw) {
          liveSummary.push(`BOTW **${prettyMetric(activeBotw.boss)}** (ends ${theme.when(activeBotw.ends_at)})`);
        }
        const eventsPointer = settings?.reminder_channel
          ? `<#${settings.reminder_channel}>`
          : '#🎯・events (events channel)';

        const checklist = [
          '**Quick setup checklist**',
          '1. You’re linked ✅',
          '2. `/subscribe add` for **SOTW** and **BOTW**',
          `3. What’s live: ${liveSummary.length ? liveSummary.join(' · ') : `No active SOTW/BOTW right now — check ${eventsPointer}.`}`,
          '4. Optional: `/clan info` for the full board',
        ].join('\n');

        await interaction.editReply({ embeds: [embed] });
        await interaction.followUp({ content: checklist, flags: 64 });
        require('../services/ranks').maybePromote(interaction.client, interaction.guildId, interaction.user.id);
      } catch (err) {
        await interaction.editReply(`❌ Could not find player "${rsn}" on Wise Old Man. Make sure the name is spelled correctly, and that the player has been looked up on wiseoldman.net at least once.`);
      }
      return;
    }

    if (sub === 'unlink') {
      const result = await db.prepare('DELETE FROM members WHERE guild_id = ? AND user_id = ?').run(interaction.guildId, interaction.user.id);

      if (result.changes > 0) {
        await interaction.reply({ content: '✅ Your RSN link has been removed.', flags: 64 });
      } else {
        await interaction.reply({ content: 'You don\'t have a linked RSN.', flags: 64 });
      }
      return;
    }

    if (sub === 'whois') {
      const user = interaction.options.getUser('user');
      const member = await db.prepare('SELECT * FROM members WHERE guild_id = ? AND user_id = ?').get(interaction.guildId, user.id);

      if (!member) {
        await interaction.reply({ content: `${user.username} has not linked an RSN.`, flags: 64 });
        return;
      }

      await interaction.reply({ content: `**${user.username}** is linked to RSN: **${member.rsn}**`, flags: 64 });
      return;
    }

    if (sub === 'list') {
      const data = await getPaginatedData('members', interaction.guildId, 0);
      if (!data || data.total === 0) {
        await interaction.reply({ content: 'No members have linked their RSN yet. Use `/me link` to get started.', flags: 64 });
        return;
      }
      await interaction.reply(buildPagePayload('members', data, 0, interaction.guildId));
    }
  },
};
