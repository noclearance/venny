const BOSSES = [
  'abyssal_sire', 'alchemical_hydra', 'amoxliatl', 'araxxor', 'artio', 'barrows_chests',
  'bryophyta', 'callisto', 'calvarion', 'cerberus', 'chambers_of_xeric',
  'chambers_of_xeric_challenge_mode', 'chaos_elemental', 'chaos_fanatic', 'commander_zilyana',
  'corporeal_beast', 'crazy_archaeologist', 'dagannoth_prime', 'dagannoth_rex', 'dagannoth_supreme',
  'duke_sucellus', 'general_graardor', 'giant_mole', 'grotesque_guardians', 'hespori',
  'kalphite_queen', 'king_black_dragon', 'kraken', 'kreearra', 'kril_tsutsaroth',
  'nex', 'nightmare', 'phosanis_nightmare', 'obor', 'phantom_muspah', 'sarachnis',
  'scorpia', 'scurrius', 'skotizo', 'sol_heredit', 'spindel', 'tempoross',
  'the_gauntlet', 'the_corrupted_gauntlet', 'the_hueycoatl', 'the_leviathan',
  'the_whisperer', 'theatre_of_blood', 'theatre_of_blood_hard_mode', 'thermonuclear_smoke_devil',
  'tombs_of_amascut', 'tombs_of_amascut_expert', 'tzkal_zuk', 'tztok_jad', 'vardorvis',
  'venenatis', 'vetion', 'vorkath', 'wintertodt', 'yama', 'zalcano', 'zulrah',
];

const BOSS_CHOICES = [
  'zulrah', 'vorkath', 'alchemical_hydra', 'cerberus', 'kraken', 'phantom_muspah',
  'nex', 'corporeal_beast', 'kalphite_queen', 'king_black_dragon', 'giant_mole',
  'commander_zilyana', 'general_graardor', 'kreearra', 'kril_tsutsaroth',
  'chambers_of_xeric', 'theatre_of_blood', 'tombs_of_amascut', 'tzkal_zuk', 'tztok_jad',
  'duke_sucellus', 'the_leviathan', 'the_whisperer', 'vardorvis', 'nightmare',
].map(value => ({ name: prettyMetric(value), value }));

const CLUE_METRICS = [
  'clue_scrolls_all', 'clue_scrolls_beginner', 'clue_scrolls_easy',
  'clue_scrolls_medium', 'clue_scrolls_hard', 'clue_scrolls_elite', 'clue_scrolls_master',
];

const KC_MILESTONES = [100, 250, 500, 1000, 2500, 5000];
const CLOG_MILESTONES = [100, 250, 500, 750, 1000, 1400];
const XP_FOR_120 = 104273167;

function prettyMetric(metric) {
  return String(metric || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace('Tzkal Zuk', 'Inferno')
    .replace('Tztok Jad', 'Fight Caves')
    .replace('Chambers Of Xeric Challenge Mode', 'CoX CM')
    .replace('Chambers Of Xeric', 'CoX')
    .replace('Theatre Of Blood Hard Mode', 'ToB HM')
    .replace('Theatre Of Blood', 'ToB')
    .replace('Tombs Of Amascut Expert', 'ToA Expert')
    .replace('Tombs Of Amascut', 'ToA');
}

function tile(label, verifyMode, metric, amount) {
  return { label, verify_mode: verifyMode, metric: metric || null, amount: amount || 0 };
}

const BINGO_POOLS = {
  bossing: [
    tile('25 Zulrah', 'wom_kc', 'zulrah', 25),
    tile('25 Vorkath', 'wom_kc', 'vorkath', 25),
    tile('25 Hydra', 'wom_kc', 'alchemical_hydra', 25),
    tile('25 Cerberus', 'wom_kc', 'cerberus', 25),
    tile('50 Kraken', 'wom_kc', 'kraken', 50),
    tile('10 Muspah', 'wom_kc', 'phantom_muspah', 10),
    tile('5 Nex', 'wom_kc', 'nex', 5),
    tile('10 Corp', 'wom_kc', 'corporeal_beast', 10),
    tile('10 KQ', 'wom_kc', 'kalphite_queen', 10),
    tile('25 Giant Mole', 'wom_kc', 'giant_mole', 25),
    tile('10 Bandos', 'wom_kc', 'general_graardor', 10),
    tile('10 Zilyana', 'wom_kc', 'commander_zilyana', 10),
    tile('10 Kree', 'wom_kc', 'kreearra', 10),
    tile('10 Kril', 'wom_kc', 'kril_tsutsaroth', 10),
    tile('5 CoX', 'wom_kc', 'chambers_of_xeric', 5),
    tile('3 ToB', 'wom_kc', 'theatre_of_blood', 3),
    tile('5 ToA', 'wom_kc', 'tombs_of_amascut', 5),
    tile('1 Jad', 'wom_kc', 'tztok_jad', 1),
    tile('10 Gauntlet', 'wom_kc', 'the_gauntlet', 10),
    tile('5 Corrupted Gauntlet', 'wom_kc', 'the_corrupted_gauntlet', 5),
    tile('10 Duke', 'wom_kc', 'duke_sucellus', 10),
    tile('10 Leviathan', 'wom_kc', 'the_leviathan', 10),
    tile('10 Whisperer', 'wom_kc', 'the_whisperer', 10),
    tile('10 Vardorvis', 'wom_kc', 'vardorvis', 10),
    tile('Any DT2 boss pet drop', 'screenshot', null, 0),
  ],
  skilling: [
    tile('100k Agility XP', 'wom_xp', 'agility', 100000),
    tile('100k Slayer XP', 'wom_xp', 'slayer', 100000),
    tile('100k Fishing XP', 'wom_xp', 'fishing', 100000),
    tile('100k Woodcutting XP', 'wom_xp', 'woodcutting', 100000),
    tile('100k Mining XP', 'wom_xp', 'mining', 100000),
    tile('100k Runecraft XP', 'wom_xp', 'runecrafting', 100000),
    tile('100k Hunter XP', 'wom_xp', 'hunter', 100000),
    tile('100k Farming XP', 'wom_xp', 'farming', 100000),
    tile('100k Thieving XP', 'wom_xp', 'thieving', 100000),
    tile('50k Construction XP', 'wom_xp', 'construction', 50000),
    tile('50k Herblore XP', 'wom_xp', 'herblore', 50000),
    tile('50k Prayer XP', 'wom_xp', 'prayer', 50000),
    tile('200k Cooking XP', 'wom_xp', 'cooking', 200000),
    tile('200k Firemaking XP', 'wom_xp', 'firemaking', 200000),
    tile('50 Wintertodt', 'wom_kc', 'wintertodt', 50),
    tile('50 Tempoross', 'wom_kc', 'tempoross', 50),
    tile('25 Zalcano', 'wom_kc', 'zalcano', 25),
    tile('Any skilling pet', 'screenshot', null, 0),
    tile('Reach 90+ in any skill', 'screenshot', null, 0),
    tile('Complete a quest', 'screenshot', null, 0),
  ],
  clues: [
    tile('10 easy clues', 'wom_activity', 'clue_scrolls_easy', 10),
    tile('10 medium clues', 'wom_activity', 'clue_scrolls_medium', 10),
    tile('5 hard clues', 'wom_activity', 'clue_scrolls_hard', 5),
    tile('3 elite clues', 'wom_activity', 'clue_scrolls_elite', 3),
    tile('1 master clue', 'wom_activity', 'clue_scrolls_master', 1),
    tile('15 clues any tier', 'wom_activity', 'clue_scrolls_all', 15),
    tile('Clue pet drop', 'screenshot', null, 0),
    tile('3rd age drop', 'screenshot', null, 0),
    tile('Gilded item', 'screenshot', null, 0),
    tile('Ranger boots', 'screenshot', null, 0),
    tile('Wizard boots', 'screenshot', null, 0),
    tile('Holy sandals', 'screenshot', null, 0),
    tile('Master clue stash fill', 'screenshot', null, 0),
    tile('Beginner clue casket', 'wom_activity', 'clue_scrolls_beginner', 1),
    tile('Hard clue screenshot', 'screenshot', null, 0),
    tile('Uri emote clue', 'screenshot', null, 0),
  ],
  pets: [
    tile('Any boss pet', 'screenshot', null, 0),
    tile('Any skilling pet', 'screenshot', null, 0),
    tile('Chompy chick', 'screenshot', null, 0),
    tile('Heron', 'screenshot', null, 0),
    tile('Rock golem', 'screenshot', null, 0),
    tile('Beaver', 'screenshot', null, 0),
    tile('Giant squirrel', 'screenshot', null, 0),
    tile('Tangleroot', 'screenshot', null, 0),
    tile('Rift guardian', 'screenshot', null, 0),
    tile('Baby chinchompa', 'screenshot', null, 0),
    tile('Pet chaos ele', 'screenshot', null, 0),
    tile('Pet dagannoth', 'screenshot', null, 0),
    tile('Pet kraken', 'screenshot', null, 0),
    tile('Pet snakeling', 'screenshot', null, 0),
    tile('Vorki', 'screenshot', null, 0),
    tile('Ikkle hydra', 'screenshot', null, 0),
    tile('Olmlet', 'screenshot', null, 0),
    tile('Lil zuk', 'screenshot', null, 0),
    tile('Jal-nib-rek', 'screenshot', null, 0),
    tile('Nexling', 'screenshot', null, 0),
  ],
  seasonal: [
    tile('50 Wintertodt', 'wom_kc', 'wintertodt', 50),
    tile('50 Tempoross', 'wom_kc', 'tempoross', 50),
    tile('25 Zalcano', 'wom_kc', 'zalcano', 25),
    tile('25 Hespori', 'wom_kc', 'hespori', 25),
    tile('10 Gauntlet', 'wom_kc', 'the_gauntlet', 10),
    tile('100k Hunter XP', 'wom_xp', 'hunter', 100000),
    tile('100k Farming XP', 'wom_xp', 'farming', 100000),
    tile('100k Firemaking XP', 'wom_xp', 'firemaking', 100000),
    tile('League/seasonal screenshot', 'screenshot', null, 0),
    tile('Holiday event complete', 'screenshot', null, 0),
    tile('Any seasonal pet', 'screenshot', null, 0),
    tile('Forestry event', 'screenshot', null, 0),
    tile('Star mining', 'screenshot', null, 0),
    tile('Guardians of the Rift 20', 'wom_activity', 'guardians_of_the_rift', 20),
    tile('Soul Wars 10', 'wom_activity', 'soul_wars_zeal', 10),
    tile('Clue any 10', 'wom_activity', 'clue_scrolls_all', 10),
  ],
  custom: [
    tile('Custom tile 1', 'screenshot', null, 0),
    tile('Custom tile 2', 'screenshot', null, 0),
    tile('Custom tile 3', 'screenshot', null, 0),
    tile('Custom tile 4', 'screenshot', null, 0),
    tile('Custom tile 5', 'screenshot', null, 0),
    tile('Custom tile 6', 'screenshot', null, 0),
    tile('Custom tile 7', 'screenshot', null, 0),
    tile('Custom tile 8', 'screenshot', null, 0),
    tile('Custom tile 9', 'screenshot', null, 0),
    tile('Custom tile 10', 'screenshot', null, 0),
    tile('Custom tile 11', 'screenshot', null, 0),
    tile('Custom tile 12', 'screenshot', null, 0),
    tile('Custom tile 13', 'screenshot', null, 0),
    tile('Custom tile 14', 'screenshot', null, 0),
    tile('Custom tile 15', 'screenshot', null, 0),
    tile('Custom tile 16', 'screenshot', null, 0),
  ],
};

function pickTiles(theme, count) {
  const pool = [...(BINGO_POOLS[theme] || BINGO_POOLS.bossing)];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const chosen = pool.slice(0, Math.min(count, pool.length));
  while (chosen.length < count) {
    chosen.push(tile(`Wildcard ${chosen.length + 1}`, 'screenshot', null, 0));
  }
  return chosen;
}

function jagexAvatar(rsn) {
  return `https://secure.runescape.com/m=avatar-rs/${encodeURIComponent(rsn)}/chat.png`;
}

module.exports = {
  BOSSES,
  BOSS_CHOICES,
  CLUE_METRICS,
  KC_MILESTONES,
  CLOG_MILESTONES,
  XP_FOR_120,
  BINGO_POOLS,
  prettyMetric,
  pickTiles,
  jagexAvatar,
};
