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

const { statusOf } = require('../src/services/sotw');
check('sotw statusOf', () => {
  assert.strictEqual(statusOf(null), 'ended');
  assert.strictEqual(statusOf({ ended: 1 }), 'ended');
  assert.strictEqual(statusOf({ ended: 0, wom_competition_id: 99 }), 'wom');
  assert.strictEqual(statusOf({ ended: 0, wom_competition_id: null }), 'local');
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
