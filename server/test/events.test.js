// Unit tests for the first-party event log (EVT-1). Run with `npm test`.
//
// Every test here runs against a throwaway database in the OS temp directory:
// PROMPTED_DB_PATH is set before db.js is first required, so the real
// server/prompted.db is never opened, and the directory is removed at the end.
const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompted-events-'));
process.env.PROMPTED_DB_PATH = path.join(tmpDir, 'events-test.db');
delete process.env.EVENTS_DISABLED;
delete process.env.EVENTS_HASH_SECRET;

const { db } = require('../db');
const events = require('../events');
const { logEvent, hashActor, settingsSnapshot, changedSettingKeys, RETENTION_MS } = events;

after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// logEvent creates the table lazily, so make sure it exists before clearing.
logEvent('bootstrap');
beforeEach(() => {
  db.exec('DELETE FROM events');
  delete process.env.EVENTS_DISABLED;
});

const rowsFor = (groupId) => db
  .prepare('SELECT * FROM events WHERE group_id = ? ORDER BY ts, rowid')
  .all(groupId)
  .map((row) => ({ ...row, props: row.props ? JSON.parse(row.props) : null }));

test('completing a round writes the expected rows in order', () => {
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

  const rows = rowsFor(groupId);
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
  assert.equal(completed.actor_id, null);
  assert.deepEqual(completed.props, {
    round: 1, submissions: 1, votes: 1, downvotes: 0, voters: 1, players: 2, wonBy: 'czar_selection', autoRearms: 0
  });

  const vote = rows.find((r) => r.name === 'vote_cast');
  assert.equal(vote.props.points, 2);
  assert.equal(vote.props.isDownvote, false);
});

test('actor ids are stored as a stable HMAC, never raw', () => {
  logEvent('member_joined', { groupId: 'GROUP_hash', actorId: 'google-sub-12345' });
  const [row] = rowsFor('GROUP_hash');
  assert.match(row.actor_id, /^[0-9a-f]{64}$/);
  assert.notEqual(row.actor_id, 'google-sub-12345');
  assert.equal(row.actor_id, hashActor('google-sub-12345'));
  assert.notEqual(hashActor('google-sub-12345'), hashActor('google-sub-67890'));

  const stored = db.prepare("SELECT value FROM meta WHERE key = 'events_hash_secret'").get();
  assert.match(stored.value, /^[0-9a-f]{64}$/);

  const everything = JSON.stringify(db.prepare('SELECT * FROM events').all());
  assert.ok(!everything.includes('google-sub-12345'));
});

test('a logging failure is swallowed and never reaches the caller', (t) => {
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => { warnings.push(args.join(' ')); });

  // A props value JSON cannot serialise.
  const circular = {};
  circular.self = circular;
  assert.doesNotThrow(() => logEvent('vote_cast', { groupId: 'GROUP_fail', circular }));
  assert.doesNotThrow(() => logEvent('vote_cast', { groupId: 'GROUP_fail', big: 10n }));

  // A genuine database failure: the table disappears under the prepared insert.
  db.exec('ALTER TABLE events RENAME TO events_parked');
  try {
    let result;
    assert.doesNotThrow(() => { result = logEvent('round_completed', { groupId: 'GROUP_fail', round: 1 }); });
    assert.equal(result, undefined);
  } finally {
    db.exec('ALTER TABLE events_parked RENAME TO events');
  }

  assert.equal(rowsFor('GROUP_fail').length, 0);
  // Reported, but rate-limited rather than once per failure.
  assert.ok(warnings.length >= 1 && warnings.length < 3, `unexpected warning count ${warnings.length}`);
  assert.match(warnings[0], /\[events\] Failed to record an event/);

  // And logging recovers once the underlying problem is gone.
  logEvent('round_completed', { groupId: 'GROUP_fail', round: 2 });
  assert.equal(rowsFor('GROUP_fail').length, 1);
});

test('EVENTS_DISABLED=1 skips writes', () => {
  process.env.EVENTS_DISABLED = '1';
  logEvent('group_created', { groupId: 'GROUP_disabled' });
  delete process.env.EVENTS_DISABLED;
  assert.equal(rowsFor('GROUP_disabled').length, 0);
});

test('rows older than the retention window are pruned opportunistically', () => {
  const insert = db.prepare('INSERT INTO events (id, ts, name, group_id) VALUES (?, ?, ?, ?)');
  insert.run('old-row', Date.now() - RETENTION_MS - 60_000, 'round_completed', 'GROUP_prune');
  insert.run('recent-row', Date.now() - RETENTION_MS + 60 * 60 * 1000, 'round_completed', 'GROUP_prune');

  events._resetPruneClock();
  logEvent('round_started', { groupId: 'GROUP_prune' });

  const ids = rowsFor('GROUP_prune').map((r) => r.id);
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
