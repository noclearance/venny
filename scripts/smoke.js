// Load every slash command and exercise card copy without hitting Discord or SpaceXAI.
process.env.OPENAI_API_KEY = '';
process.env.XAI_API_KEY = '';
process.env.BOT_SECRET = '';
process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || 'x'.repeat(60);
process.env.CLIENT_ID = process.env.CLIENT_ID || '1';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const failures = [];
function check(name, fn) {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
    console.error(`FAIL  ${name}: ${err.message}`);
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    console.log(`ok  ${name}`);
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
    console.error(`FAIL  ${name}: ${err.message}`);
  }
}

const commandsDir = path.join(__dirname, '..', 'src', 'commands');
const files = fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'));
const loaded = [];

for (const file of files) {
  const mod = require(path.join(commandsDir, file));
  check(`load ${file}`, () => {
    assert(mod.data, `${file} missing data`);
    assert(typeof mod.execute === 'function', `${file} missing execute`);
    const json = mod.data.toJSON();
    assert(json.name, `${file} missing command name`);
    loaded.push({
      file,
      json,
      skipRegister: Boolean(mod.skipRegister),
      staffSubs: mod.staffSubs || [],
      publicSubs: mod.publicSubs || [],
      adminSubs: mod.adminSubs || [],
    });
  });
}

check('expected command names', () => {
  const names = loaded.filter(c => !c.skipRegister).map(c => c.json.name).sort();
  const want = ['bingo', 'boss', 'clan', 'config', 'event', 'export', 'help', 'me', 'mod', 'rank', 'raffle', 'sotw', 'subscribe', 'vote', 'webhook'].sort();
  assert.deepStrictEqual(names, want);
});

check('lookups nested under me and clan', () => {
  const me = loaded.find(c => c.json.name === 'me');
  const clan = loaded.find(c => c.json.name === 'clan');
  const meSubs = (me.json.options || []).map(o => o.name);
  for (const name of ['link', 'unlink', 'profile', 'balance', 'goals']) {
    assert(meSubs.includes(name), `missing /me ${name}`);
  }
  const clanSubs = (clan.json.options || []).map(o => o.name);
  for (const name of ['info', 'members', 'hiscores', 'gained', 'achievements', 'credits', 'sync']) {
    assert(clanSubs.includes(name), `missing /clan ${name}`);
  }
});

check('vote results visible to members', () => {
  const vote = loaded.find(c => c.json.name === 'vote');
  assert(!vote.json.default_member_permissions, 'vote still hidden from members');
  assert(vote.adminSubs.includes('sotw') && vote.adminSubs.includes('cancel'));
});

check('rank ladder and auto thresholds', () => {
  const ranks = require('../src/services/ranks');
  assert.strictEqual(ranks.ORDER.length, 10);
  assert.strictEqual(ranks.resolveKey('Trial'), 'woodling');
  assert.strictEqual(ranks.resolveKey('Member'), 'prospector');
  assert.strictEqual(ranks.discordNameForRank('ranger'), 'Ranger');
  assert.strictEqual(ranks.discordNameForRank('not-a-rank'), '');
  assert.strictEqual(ranks.resolveKey('Admin'), 'ascendant');
  assert.strictEqual(ranks.targetFromActivity({ linked: false, goings: 1, wins: 0 }), 'woodling');
  assert.strictEqual(ranks.targetFromActivity({ linked: true, goings: 0, wins: 0 }), 'prospector');
  assert.strictEqual(ranks.targetFromActivity({ linked: true, goings: 8, wins: 0 }), 'ranger');
  assert.strictEqual(ranks.targetFromActivity({ linked: true, goings: 8, wins: 1 }), 'dragonbane');
  assert.strictEqual(ranks.targetFromActivity({ linked: true, goings: 30, wins: 0 }), 'guardian');
  assert.strictEqual(ranks.ORDER.every(k => ranks.STYLE[k]?.color && ranks.STYLE[k]?.emoji), true);
  assert.strictEqual(new Set(ranks.ORDER.map(k => ranks.STYLE[k].color)).size, 10);
  assert.strictEqual(ranks.nameMatches('🪵 Woodling', 'Woodling'), true);
  assert.strictEqual(ranks.nameMatches('Woodling', 'Woodling'), true);
  assert.strictEqual(ranks.nameMatches('Prospector', 'Woodling'), false);
  assert.strictEqual(ranks.displayName('Woodling', ranks.STYLE.woodling, false), '🪵 Woodling');
  assert.strictEqual(ranks.displayName('Woodling', ranks.STYLE.woodling, true), 'Woodling');
  assert.strictEqual(ranks.hexOf(0xB8894A), '#B8894A');
  assert.strictEqual(ranks.hexOf(0), '#000000');
  assert.deepStrictEqual(
    ranks.assignStackPositions([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  assert.deepStrictEqual(
    ranks.assignStackPositions([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  const command = loaded.find(c => c.json.name === 'rank');
  assert(command, 'missing /rank');
  const subs = (command.json.options || []).map(o => o.name);
  for (const name of ['set', 'clear', 'who']) assert(subs.includes(name), `missing /rank ${name}`);
});

check('mod is staff-only with kick timeout ban purge', () => {
  const command = loaded.find(c => c.json.name === 'mod');
  assert(command, 'missing /mod');
  assert.strictEqual(String(command.json.default_member_permissions ?? '0'), '0');
  const subs = (command.json.options || []).map(o => o.name);
  for (const name of ['timeout', 'untimeout', 'kick', 'ban', 'unban', 'purge']) {
    assert(subs.includes(name), `missing /mod ${name}`);
  }
});

check('event create has ping options', () => {
  const event = loaded.find(c => c.json.name === 'event');
  const create = (event.json.options || []).find(o => o.name === 'create');
  const names = (create.options || []).map(o => o.name);
  assert(names.includes('ping'), 'event create missing ping');
  assert(names.includes('ping_role'), 'event create missing ping_role');
});

check('moderation refuses self and owner', () => {
  const { assertCanAct, snowflake, DURATIONS } = require('../src/services/moderation');
  assert.strictEqual(snowflake('123456789012345678'), '123456789012345678');
  assert.strictEqual(snowflake('nope'), '');
  assert(DURATIONS['1h'] > 0);
  const guild = { ownerId: 'owner' };
  const actor = { id: 'mod', guild, roles: { highest: { position: 10 } } };
  const me = { id: 'bot', roles: { highest: { position: 8 } } };
  assert.throws(() => assertCanAct(actor, { id: 'mod', roles: { highest: { position: 1 } } }, me), /yourself/);
  assert.throws(() => assertCanAct(actor, { id: 'bot', roles: { highest: { position: 8 } } }, me), /myself/);
  assert.throws(() => assertCanAct(actor, { id: 'owner', roles: { highest: { position: 0 } } }, me), /owner/);
  assert.throws(() => assertCanAct(
    { id: 'mod', guild, roles: { highest: { position: 5 } } },
    { id: 'target', roles: { highest: { position: 5 } } },
    me,
  ), /at or above yours/);
  assert.throws(() => assertCanAct(actor, { id: 'target', roles: { highest: { position: 9 } } }, me), /not above/);
});

const sotw = loaded.find(c => c.json.name === 'sotw');
check('sotw subcommands', () => {
  const subs = (sotw.json.options || []).map(o => o.name);
  for (const name of ['start', 'standings', 'current', 'end', 'history', 'champions', 'me', 'update', 'cancel', 'queue', 'prize']) {
    assert(subs.includes(name), `missing /sotw ${name}`);
  }
});

check('raffle has end and draw', () => {
  const raffle = loaded.find(c => c.json.name === 'raffle');
  const subs = (raffle.json.options || []).map(o => o.name);
  assert(subs.includes('end') && subs.includes('draw') && subs.includes('create'));
  const create = (raffle.json.options || []).find(o => o.name === 'create');
  const optNames = (create.options || []).map(o => o.name);
  assert(optNames.includes('prize'), 'raffle create missing prize');
  assert(!optNames.includes('description'), 'raffle create still has description');
  const hours = (create.options || []).find(o => o.name === 'hours');
  assert(hours && !hours.required, 'raffle hours should be optional (hours OR until)');
});

check('sotw staff subs', () => {
  for (const name of ['start', 'end', 'update', 'cancel', 'prize']) {
    assert(sotw.staffSubs.includes(name), `staffSubs missing ${name}`);
  }
  assert(!sotw.publicSubs.includes('cancel'), 'sotw cancel still public');
});

const { statusOf, pickLiveCompetition } = require('../src/services/sotw');
check('sotw statusOf', () => {
  assert.strictEqual(statusOf(null), 'ended');
  assert.strictEqual(statusOf({ ended: 1 }), 'ended');
  assert.strictEqual(statusOf({ ended: 0, wom_competition_id: 99 }), 'wom');
  assert.strictEqual(statusOf({ ended: 0, wom_competition_id: null }), 'local');
});

check('pickLiveCompetition does not attach the wrong skill', () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  const past = new Date(Date.now() - 86400000).toISOString();
  const agility = { id: 1, metric: 'agility', startsAt: past, endsAt: future };
  const fishing = { id: 2, metric: 'fishing', startsAt: past, endsAt: future };
  assert.strictEqual(pickLiveCompetition([agility], 'fishing'), null);
  assert.strictEqual(pickLiveCompetition([agility, fishing], 'fishing').id, 2);
  assert.strictEqual(pickLiveCompetition([agility], null).id, 1);
  assert.strictEqual(pickLiveCompetition([{ id: 3, metric: 'agility', endsAt: past }]), null);
});

const { parseInZone } = require('../src/services/timezone');
check('event datetime parses advertised and common forms', () => {
  const tz = 'America/New_York';
  const ok = [
    '2024-12-25 19:00',
    'Dec 25 2024 7pm',
    'Dec 25 2024 7:00 PM',
    'Dec 25, 2024 7pm',
    '2026-8-25 19:00',
    '2026-08-25 7pm',
    '8/25/2026 7:00pm',
    '8/25/2026 19:00',
    '  2024-12-25 19:00  ',
    '2024-12-25 19:00:00',
    'Dec 25 2024 7:00pm',
    '2024-12-25 19:00 EST',
  ];
  for (const s of ok) {
    const d = parseInZone(s, tz);
    assert(d instanceof Date && !Number.isNaN(d.getTime()), `failed to parse ${JSON.stringify(s)}`);
  }
  assert.strictEqual(parseInZone('not a date', tz), null);
});

const { wantsCreate, wantsLookup } = require('../src/services/listen');
check('mention create vs lookup', () => {
  assert.strictEqual(wantsCreate('make an event'), true);
  assert.strictEqual(wantsCreate('create a mass'), true);
  assert.strictEqual(wantsLookup('when is the next event'), true);
  assert.strictEqual(wantsCreate('when is the next event'), false);
});

const { safeReason, commandLabel } = require('../src/services/commandFail');
check('commandFail hides secrets in error text', () => {
  assert.strictEqual(safeReason('Could not parse date'), 'Could not parse date');
  assert.match(safeReason('password leaked'), /staff/i);
  assert.strictEqual(commandLabel({ commandName: 'me', options: { getSubcommand: () => 'balance' } }), '/me balance');
  assert.strictEqual(commandLabel({ customId: 'rsvp:yes:12' }), 'button rsvp:yes:12');
});

check('award SQL qualifies coins for Postgres', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'economy.js'), 'utf8');
  assert(src.includes('economy_balances.coins + excluded.coins'));
  assert(!src.includes('SET coins = coins + excluded.coins'));
});

const { stillOpen } = require('../src/services/raffleRun');
check('raffle stillOpen', () => {
  assert.strictEqual(stillOpen({ drawn: 1, ends_at: new Date(Date.now() + 3600000).toISOString() }), false);
  assert.strictEqual(stillOpen({ drawn: 0, ends_at: new Date(Date.now() - 3600000).toISOString() }), false);
  assert.strictEqual(stillOpen({ drawn: 0, ends_at: new Date(Date.now() + 3600000).toISOString() }), true);
  assert.strictEqual(stillOpen({ drawn: 0, ends_at: null }), true);
});

const { missingChannelSlots, buildData } = require('../src/commands/config');
check('config hides assigned channel setters', () => {
  const empty = missingChannelSlots({});
  assert.strictEqual(empty.length, 3);
  const full = missingChannelSlots({
    announce_channel: '1',
    reminder_channel: '2',
    audit_channel: '3',
  });
  assert.strictEqual(full.length, 0);
  const json = buildData({
    announce_channel: '1',
    reminder_channel: '2',
    audit_channel: '3',
  }).toJSON();
  const subs = (json.options || []).map(o => o.name);
  assert(!subs.includes('announce-channel'));
  assert(!subs.includes('reminder-channel'));
  assert(!subs.includes('audit-channel'));
  assert(subs.includes('view'));
  assert(subs.includes('clear-channel'));
});

check('sotw checkpoint reminders gate at midpoint and final 24h', () => {
  const { shouldSendMidweekReminder, shouldSendEndingSoonReminder } = require('../src/services/reminders');
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const window = {
    starts_at: new Date(now - (4 * day)).toISOString(),
    ends_at: new Date(now + (3 * day)).toISOString(),
    midweek_reminder_sent: 0,
    ending_soon_reminder_sent: 0,
  };
  assert.strictEqual(shouldSendMidweekReminder(window, now), true);
  assert.strictEqual(shouldSendMidweekReminder({ ...window, midweek_reminder_sent: 1 }, now), false);
  assert.strictEqual(shouldSendMidweekReminder(window, now - (2 * day)), false);
  assert.strictEqual(shouldSendEndingSoonReminder(window, now), false);
  const lastDay = new Date(window.ends_at).getTime() - (23 * 60 * 60 * 1000);
  assert.strictEqual(shouldSendEndingSoonReminder(window, lastDay), true);
  assert.strictEqual(shouldSendEndingSoonReminder({ ...window, ending_soon_reminder_sent: 1 }, lastDay), false);
});

check('channel routing requires explicit fallback policy', () => {
  const { pickConfiguredSlots } = require('../src/services/channelRouting');
  const settings = { announce_channel: '11', reminder_channel: '22' };
  assert.deepStrictEqual(
    pickConfiguredSlots(settings, ['announce_channel', 'reminder_channel'], { allowFallback: false }),
    ['announce_channel'],
  );
  assert.deepStrictEqual(
    pickConfiguredSlots(settings, ['announce_channel', 'reminder_channel'], { allowFallback: true }),
    ['announce_channel', 'reminder_channel'],
  );
});

check('announce broadcast no longer falls back to reminder slot', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/services/announce.js'), 'utf8');
  assert(src.includes("slots: ['announce_channel']"));
  assert(!src.includes('announce_channel || settings?.reminder_channel'));
});

check('config view reports configured channel health', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/commands/config.js'), 'utf8');
  assert(src.includes('inspectConfiguredChannels'));
  assert(src.includes('Channel health'));
});

check('boss has week and end', () => {
  const boss = loaded.find(c => c.json.name === 'boss');
  const subs = (boss.json.options || []).map(o => o.name);
  assert(subs.includes('week') && subs.includes('kc') && subs.includes('end'));
});

check('raffle create stays public, draw/end are staff replies', () => {
  const raffle = loaded.find(c => c.file === 'raffle.js');
  assert.deepStrictEqual(raffle.publicSubs, ['create']);
});

check('vote polls write sotw_duration', () => {
  const voteSrc = fs.readFileSync(path.join(commandsDir, 'vote.js'), 'utf8');
  assert(voteSrc.includes('sotw_duration,'));
});

check('sotw start uses one WOM attach path', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'sotw.js'), 'utf8');
  assert(src.includes('async function ensureWomWeek'));
  assert(!src.includes('async function resolveWomId'));
  assert(!src.includes('linkWomIfMissing'));
});

const { joinDescription, make } = require('../src/services/cards');
check('hub ingest uses X-Venny-Secret and /api/bot/webhook', () => {
  const hub = require('../src/services/aisBot');
  assert.strictEqual(hub.baseUrl(), 'https://misclickerz.ai.studio/api/bot');
  assert.strictEqual(hub.ROUTES.drop, '/webhook');
  assert.strictEqual(hub.ROUTES.misclick, '/webhook');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/services/aisBot.js'), 'utf8');
  assert(src.includes("'X-Venny-Secret'"));
  assert.strictEqual(hub.ascii("we\u2019re live"), "we're live");
  const packed = hub.pack({
    type: 'event_start',
    title: "We\u2019re live",
    description: 'vampyre snail w532',
    guild_id: '1',
    facts: { world: 532, extra: { nope: true } },
  });
  assert.strictEqual(packed.type, 'event_start');
  assert.strictEqual(packed.title, "We're live");
  assert.strictEqual(packed.facts.world, 532);
  assert.strictEqual(packed.facts.extra, undefined);
  assert.strictEqual(hub.typeFromJob('sotw', 'sotw_end'), 'sotw_end');
  assert.strictEqual(hub.typeFromJob('raffle', 'raffle_start'), 'raffle_open');
});

check('clan now and ranks payloads', () => {
  const api = require('../src/services/api');
  const ranks = api.clanRanks();
  assert.strictEqual(ranks.order.length, 10);
  assert.strictEqual(ranks.names.woodling, 'Woodling');
  assert.strictEqual(ranks.aliases.trial, 'woodling');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/services/api.js'), 'utf8');
  assert(src.includes("/api/clan/now"));
  assert(src.includes("/api/clan/members"));
  assert(src.includes("/api/clan/ranks"));
});

check('sync-rank Bearer is not the Discord token', () => {
  const api = require('../src/services/api');
  assert.strictEqual(api.readBearer({ headers: { authorization: 'Bearer abc' } }), 'abc');
  assert.strictEqual(api.readBearer({ headers: { authorization: 'bearer xyz' } }), 'xyz');
  assert.strictEqual(api.readBearer({ headers: { 'x-venny-key': 'k' } }), 'k');
  assert(api.looksLikeDiscordBotToken('NOTADISCORDTOKEN0000.XXXXX.YYYYYYYYYYYYYYYYYYYYYY'));
  assert(!api.looksLikeDiscordBotToken('mc_sync_8f3K2jR9pX'));
  const { corsOrigins } = require('../src/services/api');
  assert(corsOrigins().includes('https://misclickerz.ai.studio'));
  const prev = process.env.DISCORD_TOKEN;
  process.env.DISCORD_TOKEN = 'same-secret-as-discord';
  assert(api.looksLikeDiscordBotToken('same-secret-as-discord'));
  process.env.DISCORD_TOKEN = prev;
});

check('joinDescription skips duplicate notes', () => {
  const json = { description: 'Bring a tent' };
  const out = joinDescription(json, ['Bring a tent', 'Fifteen minutes.', 'Bring a tent']);
  assert.strictEqual(out, 'Bring a tent\n\nFifteen minutes.');
});

(async () => {
  await checkAsync('stale configured channel clears exact slot and does not drift', async () => {
    const { resolveConfiguredChannel } = require('../src/services/channelRouting');
    const stale = new Error('Unknown Channel');
    stale.code = 10003;
    const fetched = [];
    const cleared = [];
    const settings = { announce_channel: '100', reminder_channel: '200' };
    const db = {
      prepare(sql) {
        return {
          get: async () => ({ ...settings }),
          run: async () => {
            if (sql.includes('announce_channel')) {
              settings.announce_channel = null;
              cleared.push('announce_channel');
            }
            if (sql.includes('reminder_channel')) {
              settings.reminder_channel = null;
              cleared.push('reminder_channel');
            }
            return { changes: 1 };
          },
        };
      },
    };
    const client = {
      channels: {
        fetch: async id => {
          fetched.push(id);
          if (id === '100') throw stale;
          return { id, send: async () => ({ id: 'x' }) };
        },
      },
    };

    const strict = await resolveConfiguredChannel(client, 'guild', {
      slots: ['announce_channel', 'reminder_channel'],
      allowFallback: false,
      db,
    });
    assert.strictEqual(strict, null);
    assert.deepStrictEqual(fetched, ['100']);
    assert.deepStrictEqual(cleared, ['announce_channel']);

    const fetched2 = [];
    const cleared2 = [];
    const settings2 = { announce_channel: '100', reminder_channel: '200' };
    const db2 = {
      prepare(sql) {
        return {
          get: async () => ({ ...settings2 }),
          run: async () => {
            if (sql.includes('announce_channel')) {
              settings2.announce_channel = null;
              cleared2.push('announce_channel');
            }
            if (sql.includes('reminder_channel')) {
              settings2.reminder_channel = null;
              cleared2.push('reminder_channel');
            }
            return { changes: 1 };
          },
        };
      },
    };
    const client2 = {
      channels: {
        fetch: async id => {
          fetched2.push(id);
          if (id === '100') throw stale;
          return { id, send: async () => ({ id: 'y' }) };
        },
      },
    };
    const withFallback = await resolveConfiguredChannel(client2, 'guild', {
      slots: ['announce_channel', 'reminder_channel'],
      allowFallback: true,
      db: db2,
    });
    assert.strictEqual(withFallback.slot, 'reminder_channel');
    assert.deepStrictEqual(fetched2, ['100', '200']);
    assert.deepStrictEqual(cleared2, ['announce_channel']);
  });

  await checkAsync('mentionFor everyone is launch-only', async () => {
    const { mentionFor } = require('../src/services/subscriptions');
    const launch = await mentionFor({ mode: 'everyone' });
    assert.strictEqual(launch.content, '@everyone');
    assert(launch.allowedMentions.parse.includes('everyone'));
    const reminder = await mentionFor({ mode: 'everyone', forReminder: true, roleId: '99' });
    assert.strictEqual(reminder.content, '<@&99>');
    assert(!reminder.allowedMentions.parse.includes('everyone'));
    const off = await mentionFor({ mode: 'off' });
    assert.strictEqual(off.content, undefined);
  });

  await checkAsync('cards.make fallback does not duplicate notes', async () => {
    const notes = 'Necklace of Anguish / or gold';
    const made = await make('event', {
      job: 'event_remind',
      facts: { title: 'Mass', alreadyReminded: false },
      fallbackTitle: 'Mass',
      fallbackDescription: notes,
      extraLines: [notes, 'If you’re coming, be logged in.'],
    });
    const desc = made.embed.data.description;
    const hits = desc.split('Necklace of Anguish / or gold').length - 1;
    assert.strictEqual(hits, 1, `notes appeared ${hits} times:\n${desc}`);
    assert.strictEqual(made.json.description, notes);
    assert.notStrictEqual(made.embed.data.description, made.json.description);
  });

  await checkAsync('cards.make flavor json stays extra-line free', async () => {
    const made = await make('sotw', {
      job: 'sotw_start',
      facts: { skill: 'fishing', days: 7, wom: false },
      extraLines: ['Local SOTW is still running.'],
    });
    assert(!String(made.json.description).includes('Local SOTW is still running.'));
    assert(String(made.embed.data.description).includes('Local SOTW is still running.'));
    assert.strictEqual(made.json.source, 'fallback');
  });

  const { venny } = require('../src/services/cards');
  const economy = require('../src/services/economy');
  const theme = require('../src/services/theme');
  const flavor = require('../src/services/flavor');

  check('prizeLine puts loot first', () => {
    const line = economy.prizeLine('sotw_win', 'bond');
    assert(line.startsWith('**bond**'), line);
    assert(line.includes('50'), line);
    assert.strictEqual(theme.prizeField(line).name, 'Prize');
    assert.strictEqual(theme.prizeField(line).inline, false);
  });

  check('sotw and boss start have prize option', () => {
    const sotwStart = (sotw.json.options || []).find(o => o.name === 'start');
    assert((sotwStart.options || []).some(o => o.name === 'prize'));
    const boss = loaded.find(c => c.json.name === 'boss');
    const week = (boss.json.options || []).find(o => o.name === 'week');
    assert((week.options || []).some(o => o.name === 'prize'));
  });

  check('raffle fallback does not invent loot', () => {
    const card = flavor.venny('raffle_start', { title: 'Clan casket' });
    assert.strictEqual(card.source, 'venny');
    assert(!/legendary boon|prize worthy/i.test(card.description), card.description);
    assert.strictEqual(card.title, 'Clan casket');
  });

  check('venny card posts Prize immediately', () => {
    const card = venny('sotw', {
      job: 'sotw_start',
      facts: { skill: 'agility', prize: '50m' },
      fallbackTitle: 'agility SOTW',
      fields: [theme.prizeField(economy.prizeLine('sotw_win', '50m'))],
    });
    assert.strictEqual(card.json.source, 'venny');
    const prize = (card.embed.data.fields || []).find(f => f.name === 'Prize');
    assert(prize, 'missing Prize field');
    assert(prize.value.includes('50m'), prize.value);
  });

  check('flavor fallback when no key', () => {
    const card = flavor.venny('event_start', { title: 'ToB' });
    assert.strictEqual(card.source, 'venny');
    assert(card.title);
  });

  check('flavor uses SpaceXAI grok-4.5', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/services/flavor.js'), 'utf8');
    assert(src.includes('https://api.x.ai/v1/chat/completions'));
    assert(src.includes('grok-4.5'));
    assert(src.includes('XAI_API_KEY'));
    assert(!src.includes('api.openai.com'));
    assert(!src.includes('gpt-4o-mini'));
  });

  check('EST is fixed UTC-5 not New York DST', () => {
    const { parseInZone } = require('../src/services/timezone');
    const d = parseInZone('2026-01-15 19:00 EST', 'UTC');
    assert(d, 'EST parse failed');
    assert.strictEqual(d.getUTCHours(), 0);
  });

  check('undated month-day rolls to the next future occurrence', () => {
    const { DateTime } = require('luxon');
    const { parseInZone } = require('../src/services/timezone');
    const past = DateTime.now().minus({ days: 40 }).toFormat('MMM d h:mm a');
    const d = parseInZone(past, 'UTC');
    assert(d && d.getTime() > Date.now(), `expected future, got ${d}`);
  });

  check('maxed requires sailing 99', () => {
    const { parsePlayer } = require('../src/osrs/snapshot');
    const { SKILLS } = require('../src/services/wom');
    const skills = { overall: { level: 2277, experience: 1 } };
    for (const s of SKILLS.filter(x => x !== 'overall' && x !== 'sailing')) {
      skills[s] = { level: 99, experience: 13034431 };
    }
    skills.sailing = { level: 1, experience: 0 };
    const parsed = parsePlayer({ latestSnapshot: { data: { skills, bosses: {}, activities: {} } } });
    assert.strictEqual(parsed.maxed, false);
  });

  check('kc milestone is not branded as SOTW', () => {
    const { embedFor } = require('../src/services/achievements');
    const kc = embedFor({ title: '2500 Nex KC', kind: 'kc', key: 'kc:nex:2500', rsn: 'thuggerszn' }, '<@1>').toJSON();
    const kcText = JSON.stringify(kc);
    assert(!/Skill of the Week/i.test(kcText), kcText);
    assert(/Bossing/.test(kcText), kcText);
    const ninety = embedFor({ title: '99 Agility', kind: '99', key: '99:agility', rsn: 'x' }, '<@1>').toJSON();
    assert(!/Skill of the Week/i.test(JSON.stringify(ninety)), JSON.stringify(ninety));
  });

  if (failures.length) {
    console.error(`\n${failures.length} failure(s)`);
    process.exit(1);
  }
  console.log(`\n${loaded.length} commands loaded. smoke ok.`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
