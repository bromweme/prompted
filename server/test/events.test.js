// Unit tests for the first-party event log (EVT-1). Run with `npm test`.
//
// These run against whichever driver is configured, like persistence.test.js,
// so the same assertions cover SQLite locally and Postgres in CI:
//
//   npm test                                                  # SQLite
//   DATABASE_URL=postgres://... DATABASE_SCHEMA=t1 npm test    # Postgres
//
// Nothing here touches SQL. Rows are read back through the module's own read
// path, and each test uses its own group id instead of clearing the table, so
// the tests never need to know what the log is stored in.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const usingPostgres = !!process.env.DATABASE_URL;
let tmpDir = null;
if (!usingPostgres) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompted-events-'));
  process.env.PROMPTED_DB_PATH = path.join(tmpDir, 'events-test.db');
} else {
  // Never let a test run loose in the default schema of a real database, and
  // take a schema of our own even when the run named one: this file drops what
  // it created, and node --test may be running another file in parallel.
  const base = !process.env.DATABASE_SCHEMA || process.env.DATABASE_SCHEMA === 'public'
    ? `test_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    : process.env.DATABASE_SCHEMA;
  process.env.DATABASE_SCHEMA = `${base}_events`;
}
delete process.env.EVENTS_DISABLED;

const { driver } = require('../db');
const events = require('../events');
const {
  logEvent, flushEvents, readEvents, hashActor,
  settingsSnapshot, changedSettingKeys, RETENTION_MS
} = events;

after(async () => {
  await flushEvents();
  if (usingPostgres) await driver.dropSchema();
  await driver.close();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

const rowsFor = async (groupId) => {
  await flushEvents();
  return readEvents({ groupId });
};

test('completing a round writes the expected rows in order', async () => {
  const groupId = 'GROUP_round_test';
  // The same call sequence server.js makes for a two-player round resolved by
  // the Judge's pick.
  logEvent('group_created', { groupId, actorId: 'host-user', isPrivate: false, hasDescription: false, settings: { voteBudget: 10 } });
  logEvent('member_joined', { groupId, actorId: 'guest-user', players: 2, groupStatus: 'setup' });
  logEvent('round_started', { groupId, actorId: 'host-user', round: 1, players: 2, judgeHandPicked: false, afterStall: false });
  logEvent('topic_selected', { groupId, actorId: 'host-user', round: 1, ownTopic: true, isPublic: false, judgeMustPlay: false });
  logEvent('submission_made', { groupId, actorId: 'guest-user', round: 1, submissionNumber: 1 });
  logEvent('voting_opened', { groupId, round: 1, trigger: 'all_submitted', submissions: 1 });
  logEvent('vote_cast', { groupId, actorId: 'host-user', round: 1, points: 2, isDownvote: false, budgetUsed: 2, budget: 10, isJudge: true, hasComment: false });
  logEvent('winner_selected', { groupId, actorId: 'host-user', round: 1 });
  logEvent('round_completed', { groupId, round: 1, submissions: 1, votes: 1, downvotes: 0, voters: 1, players: 2, wonBy: 'czar_selection', autoRearms: 0 });
  logEvent('round_completed', { groupId: 'GROUP_other', round: 1 });

  const rows = await rowsFor(groupId);
  assert.deepEqual(rows.map((r) => r.name), [
    'group_created', 'member_joined', 'round_started', 'topic_selected',
    'submission_made', 'voting_opened', 'vote_cast', 'winner_selected', 'round_completed'
  ]);

  for (const row of rows) {
    assert.match(row.id, /^[0-9a-f-]{36}$/);
    assert.equal(typeof row.ts, 'number');
    assert.ok(Math.abs(Date.now() - row.ts) < 60_000);
    // Neither groupId nor actorId is duplicated into props.
    assert.ok(!row.props || !('groupId' in row.props));
    assert.ok(!row.props || !('actorId' in row.props));
  }

  const completed = rows.at(-1);
  assert.equal(completed.actorId, null);
  assert.deepEqual(completed.props, {
    round: 1, submissions: 1, votes: 1, downvotes: 0, voters: 1, players: 2, wonBy: 'czar_selection', autoRearms: 0
  });

  const vote = rows.find((r) => r.name === 'vote_cast');
  assert.equal(vote.props.points, 2);
  assert.equal(vote.props.isDownvote, false);
});

test('actor ids are stored as a stable HMAC, never raw', async () => {
  logEvent('member_joined', { groupId: 'GROUP_hash', actorId: 'google-sub-12345' });
  const [row] = await rowsFor('GROUP_hash');
  assert.match(row.actorId, /^[0-9a-f]{64}$/);
  assert.notEqual(row.actorId, 'google-sub-12345');
  assert.equal(row.actorId, hashActor('google-sub-12345'));
  assert.notEqual(hashActor('google-sub-12345'), hashActor('google-sub-67890'));

  // The secret lives in the environment (config.js), not in a row of the
  // database it pseudonymises: a wiped database used to mean a new secret and
  // therefore a new actor id for the same player.
  const everything = JSON.stringify(await readEvents());
  assert.ok(!everything.includes('google-sub-12345'));
});

test('a logging failure is swallowed and never reaches the caller', async (t) => {
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => { warnings.push(args.join(' ')); });

  // A props value JSON cannot serialise.
  const circular = {};
  circular.self = circular;
  assert.doesNotThrow(() => logEvent('vote_cast', { groupId: 'GROUP_fail', circular }));
  assert.doesNotThrow(() => logEvent('vote_cast', { groupId: 'GROUP_fail', big: 10n }));

  // A genuine database failure: the insert rejects, whatever the driver is.
  const insert = t.mock.method(driver, 'insertEvent', async () => {
    throw new Error('simulated write failure');
  });
  let result;
  assert.doesNotThrow(() => { result = logEvent('round_completed', { groupId: 'GROUP_fail', round: 1 }); });
  assert.equal(result, undefined);
  await flushEvents();
  insert.mock.restore();

  assert.equal((await rowsFor('GROUP_fail')).length, 0);
  // Reported, but rate-limited rather than once per failure.
  assert.ok(warnings.length >= 1 && warnings.length < 3, `unexpected warning count ${warnings.length}`);
  assert.match(warnings[0], /\[events\] Failed to record an event/);

  // And logging recovers once the underlying problem is gone.
  logEvent('round_completed', { groupId: 'GROUP_fail', round: 2 });
  assert.equal((await rowsFor('GROUP_fail')).length, 1);
});

test('EVENTS_DISABLED=1 skips writes', async () => {
  process.env.EVENTS_DISABLED = '1';
  logEvent('group_created', { groupId: 'GROUP_disabled' });
  delete process.env.EVENTS_DISABLED;
  assert.equal((await rowsFor('GROUP_disabled')).length, 0);
});

test('rows older than the retention window are pruned opportunistically', async () => {
  // Seeded through the driver rather than logEvent, which always stamps now.
  // A read first, so the tables exist before we write behind the module's back.
  await readEvents({ groupId: 'GROUP_prune' });
  await driver.insertEvent({
    id: 'old-row', ts: Date.now() - RETENTION_MS - 60_000,
    name: 'round_completed', groupId: 'GROUP_prune', actorId: null, props: null
  });
  await driver.insertEvent({
    id: 'recent-row', ts: Date.now() - RETENTION_MS + 60 * 60 * 1000,
    name: 'round_completed', groupId: 'GROUP_prune', actorId: null, props: null
  });

  events._resetPruneClock();
  logEvent('round_started', { groupId: 'GROUP_prune' });

  const ids = (await rowsFor('GROUP_prune')).map((r) => r.id);
  assert.ok(!ids.includes('old-row'));
  assert.ok(ids.includes('recent-row'));
  assert.equal(ids.length, 2);
});

test('settings helpers only expose allowlisted keys and safe values', () => {
  const snapshot = settingsSnapshot({
    voteBudget: 12, shareTheWealth: false, topicSelection: 'czar',
    'Jane Doe <jane@example.com>': true, totalRounds: Infinity
  });
  assert.deepEqual(snapshot, { voteBudget: 12, shareTheWealth: false });

  const keys = changedSettingKeys(
    { voteBudget: 10, allowDownvotes: false, submissionTime: 24 },
    { voteBudget: 10, allowDownvotes: true, submissionTime: 12, 'free text key': 1 }
  );
  assert.deepEqual(keys, ['allowDownvotes', 'submissionTime']);
});
