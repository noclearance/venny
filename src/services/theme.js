const { EmbedBuilder } = require('discord.js');
const { getSkillEmoji } = require('./wom');

// Venny — Misclickers clan helper.
// Same layout every time. Accent color by job. Voice is one person, not a brochure.

const VENNY = {
  name: 'Venny',
  role: 'Misclickers · clan helper',
  icon: 'https://oldschool.runescape.wiki/images/Wise_Old_Man_chathead.png',
};

const COLORS = {
  brand: 0x1F4E46,
  sotw: 0xC2410C,
  event: 0x15803D,
  raffle: 0x6D28D9,
  poll: 0x1D4ED8,
  success: 0x047857,
  danger: 0x9F1239,
  info: 0x0E7490,
  muted: 0x44403C,
};

const CATEGORY_ICONS = {
  general: '📌',
  boss: '💀',
  pvm: '⚔️',
  skilling: '⛏️',
  social: '🍻',
  sotw: '🏆',
  botw: '🐉',
  raffle: '🎟️',
};

const COPY = {
  eventPosted: [
    'I need a count. Hit a button — don’t just lurk.',
    'Who’s actually showing? Mark yourself.',
    'Worlds are easier when I know numbers. In or out.',
  ],
  eventSoon: [
    'Fifteen minutes. If you’re coming, be logged in.',
    'Last call. Get to a bank and hop.',
    'We’re close. Don’t be the one still in the GE.',
  ],
  eventNow: [
    'It’s up. Get in.',
    'Live. If you RSVP’d, you better be here.',
    'Starting. Stop afking the login screen.',
  ],
  sotwOpen: [
    'Skill’s locked. Gains from this second count.',
    'Week’s live. `/sotw me` if you want your place without the speech.',
    'Don’t sandbag. I’m posting standings whether you’re ready or not.',
  ],
  sotwEmpty: [
    'Board’s empty. Someone train the damn skill.',
    'No XP yet. First person on here looks heroic by default.',
    'Waiting on gains. WOM hasn’t seen anyone move.',
  ],
  sotwEnded: [
    'That’s a wrap. Numbers below — no recounts.',
    'Week’s done. Congrats to first. Everyone else, there’s next week.',
    'Final board. Screenshot it or it didn’t happen.',
  ],
  raffleOpen: [
    'Tickets are 150k GP each, paid in game. Linked RSN or you don’t exist.',
    '150k a ticket. Pay in game, then tap Enter. I’ll draw later — no crying in DMs.',
    'Want in? 150k GP to staff, then the button. `/member link` first.',
  ],
  raffleWon: [
    'Drawn. That’s the name. Raffle’s dead.',
    'Winner’s up. Everyone else, next time.',
  ],
  dashboardQuiet: [
    'Board’s quiet. Post a mass or start a skill. I’m not inventing content.',
    'Nothing live. That’s on you lot, not me.',
  ],
  dashboardBusy: [
    'Here’s what’s actually on. Read it once.',
    'Live board. If you ping me asking what’s on, I’m sending you this.',
  ],
  bingoDraft: [
    'Paste the list or load a template. I’m not typing 25 tiles for you.',
    'Dump the board in one paste. One-by-one is how we lose an hour.',
    'Template or bulk paste. That’s the whole job.',
  ],
  sotwEvent: [
    'This is the Skill of the Week — it lives on the calendar until it ends.',
    'SOTW is an event. Deadline is the time on this card.',
    'Train it until the stamp below. That’s the week.',
  ],
  mentionHelp: [
    'Ping me with **sotw**, **next mass**, or **raffle**. Or just `/clan info`.',
    'I’m the clerk, not your alt. Ask about SOTW, the next event, or a raffle.',
  ],
  voteRoll: [
    'I rolled these. Nobody stacked the deck.',
    'Random draw. Vote like you mean it.',
    'These came out of the bag. Don’t blame me if it’s Agility.',
  ],
};

const EMPTY = {
  sotw: 'No SOTW. A mod can `/sotw start` when they pick a skill.',
  events: 'Nothing on the calendar. `/event create` if you want a mass.',
  raffles: 'No raffle open.',
  polls: 'No vote running.',
  members: 'Nobody’s linked. `/member link` your RSN or you’re a ghost.',
  standings: 'No XP on the board yet.',
};

function hashSeed(seed) {
  const text = String(seed ?? '');
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function line(key, seed) {
  const list = COPY[key];
  if (!list || !list.length) return '';
  return list[hashSeed(seed) % list.length];
}

function when(iso) {
  const ts = Math.floor(new Date(iso).getTime() / 1000);
  if (!Number.isFinite(ts)) return 'Time not set';
  return `<t:${ts}:F> · <t:${ts}:R>`;
}

function skillIconUrl(skill) {
  const key = String(skill || 'overall').toLowerCase();
  if (key === 'overall') return 'https://oldschool.runescape.wiki/images/Stats_icon.png';
  const file = key.charAt(0).toUpperCase() + key.slice(1);
  return `https://oldschool.runescape.wiki/images/${file}_icon.png`;
}

function medal(index) {
  return ['🥇', '🥈', '🥉'][index] || `\`${index + 1}.\``;
}

function rankLines(rows, formatRow) {
  if (!rows || rows.length === 0) return EMPTY.standings;
  return rows.map((row, i) => `${medal(i)} ${formatRow(row, i)}`).join('\n');
}

function field(name, value, inline = false) {
  const text = value == null || value === '' ? '—' : String(value);
  return { name, value: text.slice(0, 1024), inline };
}

const KIND_FACE = {
  brand: { tag: 'Clan board' },
  sotw: { tag: 'Skill of the Week' },
  event: { tag: 'Clan event' },
  raffle: { tag: 'Raffle' },
  poll: { tag: 'Clan vote' },
  success: { tag: 'Locked in' },
  danger: { tag: 'Bossing' },
  info: { tag: 'Look-up' },
  muted: { tag: 'Note' },
};

const KIND_THUMB = {
  raffle: 'https://oldschool.runescape.wiki/images/Casket.png',
  event: 'https://oldschool.runescape.wiki/images/Map_link_icon.png',
  poll: 'https://oldschool.runescape.wiki/images/Skull_sceptre.png',
};

function embed(kind, {
  title,
  description,
  fields,
  url,
  thumbnail,
  image,
  author,
  footer,
  timestamp = false,
} = {}) {
  const built = new EmbedBuilder().setColor(COLORS[kind] || COLORS.brand);
  const face = KIND_FACE[kind] || KIND_FACE.brand;

  const who = author === false
    ? null
    : author || { name: `${VENNY.name}  ·  ${face.tag}`, iconURL: VENNY.icon };

  if (who) built.setAuthor(who);
  if (title) built.setTitle(title);
  if (description) built.setDescription(description);
  if (url) built.setURL(url);
  if (thumbnail) built.setThumbnail(thumbnail);
  else if (KIND_THUMB[kind]) built.setThumbnail(KIND_THUMB[kind]);
  else if (kind === 'sotw') built.setThumbnail(skillIconUrl('overall'));
  if (image) built.setImage(image);
  if (fields && fields.length) built.addFields(fields.filter(Boolean));
  if (timestamp) built.setTimestamp();
  built.setFooter({ text: footer || `${face.tag}  ·  Misclickers` });

  return built;
}

function categoryIcon(category) {
  return CATEGORY_ICONS[category] || CATEGORY_ICONS.general;
}

module.exports = {
  VENNY,
  COLORS,
  CATEGORY_ICONS,
  COPY,
  EMPTY,
  line,
  when,
  skillIconUrl,
  medal,
  rankLines,
  field,
  embed,
  categoryIcon,
  getSkillEmoji,
};
