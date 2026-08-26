// Load every slash command and exercise card copy without hitting Discord or OpenAI.
process.env.OPENAI_API_KEY = '';
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
    loaded.push({ file, json, staffSubs: mod.staffSubs || [], publicSubs: mod.publicSubs || [], adminSubs: mod.adminSubs || [] });
  });
}

check('expected command names', () => {
  const names = loaded.map(c => c.json.name).sort();
  const want = ['achievements', 'bingo', 'boss', 'clan', 'config', 'economy', 'event', 'export', 'goal', 'help', 'leaderboard', 'member', 'profile', 'raffle', 'sotw', 'subscribe', 'vote', 'webhook'].sort();
  assert.deepStrictEqual(names, want);
});

const sotw = loaded.find(c => c.json.name === 'sotw');
check('sotw subcommands', () => {
  const subs = (sotw.json.options || []).map(o => o.name);
  for (const name of ['start', 'standings', 'current', 'end', 'history', 'champions', 'me', 'update', 'cancel', 'queue']) {
    assert(subs.includes(name), `missing /sotw ${name}`);
  }
});

check('raffle has end and draw', () => {
  const raffle = loaded.find(c => c.json.name === 'raffle');
  const subs = (raffle.json.options || []).map(o => o.name);
  assert(subs.includes('end') && subs.includes('draw') && subs.includes('create'));
});

check('sotw staff subs', () => {
  for (const name of ['start', 'end', 'update', 'cancel']) {
    assert(sotw.staffSubs.includes(name), `staffSubs missing ${name}`);
  }
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

const { safeReason } = require('../src/services/commandFail');
check('commandFail hides secrets in error text', () => {
  assert.strictEqual(safeReason('Could not parse date'), 'Could not parse date');
  assert.match(safeReason('password leaked'), /staff/i);
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
check('joinDescription skips duplicate notes', () => {
  const json = { description: 'Bring a tent' };
  const out = joinDescription(json, ['Bring a tent', 'Fifteen minutes.', 'Bring a tent']);
  assert.strictEqual(out, 'Bring a tent\n\nFifteen minutes.');
});

(async () => {
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

  if (failures.length) {
    console.error(`\n${failures.length} failure(s)`);
    process.exit(1);
  }
  console.log(`\n${loaded.length} commands loaded. smoke ok.`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
