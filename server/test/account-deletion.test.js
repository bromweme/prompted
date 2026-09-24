// Unit tests for account deletion (PRIV-1). Run with `npm test`.
//
// The privacy policy promises erasure, so these tests are the evidence for
// that promise. They run the real module against in-memory stores that expose
// the same surface PersistentStore does (get/has/set/delete/values), because
// what is being tested is the deletion semantics, not the database.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { deleteAccount } = require('../account-deletion');

// A stand-in for PersistentStore: same methods, no I/O.
function fakeStore(entries = []) {
  const map = new Map(entries);
  return {
    get: (id) => map.get(id),
    has: (id) => map.has(id),
    set: (id, value) => map.set(id, value),
    delete: (id) => map.delete(id),
    values: () => map.values(),
    forEach: (fn) => map.forEach(fn),
    size: () => map.size,
    raw: map
  };
}

function stores({ groups = [], topics = [], notifications = [], users = [] } = {}) {
  const removed = [];
  return {
    groups: fakeStore(groups),
    topics: fakeStore(topics),
    notifications: fakeStore(notifications),
    users: fakeStore(users),
    inviteIndex: { remove: (group) => removed.push(group.id) },
    removedFromIndex: removed
  };
}

const ME = 'google-me';
const OTHER = 'google-other';

function player(userId, extra = {}) {
  return { id: `sock_${userId}`, userId, username: userId, score: 0, isHost: false, connected: true, ...extra };
}

test('a profile, its topics and its notifications are deleted outright', () => {
  const s = stores({
    users: [[ME, { userId: ME, displayName: 'Me' }], [OTHER, { userId: OTHER }]],
    topics: [
      ['t1', { id: 't1', text: 'mine private', creatorId: ME, isPublic: false }],
      ['t2', { id: 't2', text: 'mine public', creatorId: ME, isPublic: true }],
      ['t3', { id: 't3', text: 'theirs', creatorId: OTHER }]
    ],
    notifications: [[ME, { items: [{ id: 'n1' }] }], [OTHER, { items: [] }]]
  });

  const summary = deleteAccount(ME, s);

  assert.equal(s.users.get(ME), undefined);
  assert.ok(s.users.get(OTHER), "another player's profile is untouched");
  // Public topics go too: "public" means offered to groupmates, not donated.
  assert.equal(summary.topicsDeleted, 2);
  assert.equal(s.topics.get('t1'), undefined);
  assert.equal(s.topics.get('t2'), undefined);
  assert.ok(s.topics.get('t3'), "another player's topic is untouched");
  assert.equal(s.notifications.get(ME), undefined);
  assert.ok(s.notifications.get(OTHER), "another player's notifications are untouched");
});

test('a hosted group with other members is handed over, not destroyed', () => {
  const s = stores({
    groups: [['g1', {
      id: 'g1',
      host: ME,
      players: [player(ME, { isHost: true }), player(OTHER), player('third')]
    }]]
  });

  const summary = deleteAccount(ME, s);
  const group = s.groups.get('g1');

  assert.ok(group, 'the group survives');
  assert.equal(group.host, OTHER, 'the longest-standing remaining member inherits');
  assert.equal(group.players.length, 2);
  assert.equal(group.players.find(p => p.userId === OTHER).isHost, true);
  assert.equal(group.players.find(p => p.userId === 'third').isHost, false);
  assert.deepEqual(summary.groupsRehosted, [{ groupId: 'g1', newHost: OTHER }]);
  assert.deepEqual(summary.groupsDeleted, []);
});

test('a hosted group with nobody else in it is deleted, and its invite code with it', () => {
  const s = stores({
    groups: [['g1', { id: 'g1', host: ME, inviteCode: 'ABC123', players: [player(ME, { isHost: true })] }]]
  });

  const summary = deleteAccount(ME, s);

  assert.equal(s.groups.get('g1'), undefined);
  assert.deepEqual(summary.groupsDeleted, ['g1']);
  assert.deepEqual(s.removedFromIndex, ['g1'], 'the invite code must not outlive the group');
});

test('membership of a group hosted by someone else is simply removed', () => {
  const s = stores({
    groups: [['g1', { id: 'g1', host: OTHER, players: [player(OTHER, { isHost: true }), player(ME)] }]]
  });

  deleteAccount(ME, s);
  const group = s.groups.get('g1');

  assert.equal(group.host, OTHER, 'the host is unaffected');
  assert.deepEqual(group.players.map(p => p.userId), [OTHER]);
});

test("shared rounds lose their owner but keep their shape, so other players' history survives", () => {
  const round = {
    judgeUserId: OTHER,
    submissions: [
      { id: 's1', playerUserId: ME, videoId: 'v1', title: 'mine' },
      { id: 's2', playerUserId: OTHER, videoId: 'v2', title: 'theirs' }
    ],
    votes: [
      { voterUserId: ME, submissionId: 's2', points: 3, comment: 'nice' },
      { voterUserId: OTHER, submissionId: 's1', points: 2, comment: 'also nice' }
    ],
    voteBudgetUsed: { [ME]: 3, [OTHER]: 2 },
    winnerUserId: ME
  };
  const s = stores({
    groups: [['g1', { id: 'g1', host: OTHER, players: [player(OTHER, { isHost: true }), player(ME)], history: [round] }]]
  });

  const summary = deleteAccount(ME, s);
  const past = s.groups.get('g1').history[0];
  const tomb = summary.tombstone;

  // Nothing is removed — the round still has two submissions and two votes,
  // so the other player's score and history are unchanged.
  assert.equal(past.submissions.length, 2);
  assert.equal(past.votes.length, 2);

  assert.equal(past.submissions[0].playerUserId, tomb, 'their submission is no longer theirs');
  assert.equal(past.submissions[0].title, 'mine', 'but the round still reads correctly');
  assert.equal(past.submissions[1].playerUserId, OTHER);
  assert.equal(past.votes[0].voterUserId, tomb);
  assert.equal(past.votes[1].voterUserId, OTHER);
  assert.equal(past.winnerUserId, tomb);
  assert.equal(past.judgeUserId, OTHER);

  // The budget map is keyed by user id, so the key itself had to move.
  assert.equal(past.voteBudgetUsed[ME], undefined);
  assert.equal(past.voteBudgetUsed[tomb], 3);
  assert.equal(past.voteBudgetUsed[OTHER], 2);
});

test('history in a group they already left is anonymised too', () => {
  const s = stores({
    groups: [['g1', {
      id: 'g1',
      host: OTHER,
      players: [player(OTHER, { isHost: true })], // they are not a member any more
      history: [{ submissions: [{ id: 's1', playerUserId: ME }], votes: [] }]
    }]]
  });

  const summary = deleteAccount(ME, s);

  assert.notEqual(s.groups.get('g1').history[0].submissions[0].playerUserId, ME);
  assert.equal(s.groups.get('g1').history[0].submissions[0].playerUserId, summary.tombstone);
});

test('two deleted players do not collapse into one identity', () => {
  const round = { submissions: [{ id: 's1', playerUserId: ME }, { id: 's2', playerUserId: OTHER }], votes: [] };
  const s = stores({
    groups: [['g1', { id: 'g1', host: 'third', players: [player('third', { isHost: true })], history: [round] }]]
  });

  const first = deleteAccount(ME, s);
  const second = deleteAccount(OTHER, s);
  const past = s.groups.get('g1').history[0];

  assert.notEqual(first.tombstone, second.tombstone);
  assert.notEqual(past.submissions[0].playerUserId, past.submissions[1].playerUserId,
    'a shared sentinel would corrupt per-user round maths');
});

test('a ban outlives the account, so deleting is not a way out of moderation', () => {
  const s = stores({
    groups: [['g1', {
      id: 'g1',
      host: OTHER,
      players: [player(OTHER, { isHost: true })],
      bannedUsers: [{ userId: ME, username: 'Me' }]
    }]]
  });

  deleteAccount(ME, s);

  assert.deepEqual(s.groups.get('g1').bannedUsers, [{ userId: ME, username: 'Me' }]);
});

test('pending join requests, decline counts and host notices about them are cleared', () => {
  const s = stores({
    groups: [['g1', {
      id: 'g1',
      host: OTHER,
      players: [player(OTHER, { isHost: true })],
      joinRequests: [{ userId: ME, username: 'Me' }, { userId: 'third', username: 'Third' }],
      declineCounts: { [ME]: 2, third: 1 },
      hostNotices: [{ userId: ME, message: 'Me asked to join' }, { userId: 'third', message: 'keep' }]
    }]]
  });

  deleteAccount(ME, s);
  const group = s.groups.get('g1');

  assert.deepEqual(group.joinRequests.map(r => r.userId), ['third']);
  assert.equal(group.declineCounts[ME], undefined);
  assert.equal(group.declineCounts.third, 1);
  assert.deepEqual(group.hostNotices.map(n => n.userId), ['third']);
});

test('still-connected members of affected groups are reported, once each', () => {
  const s = stores({
    groups: [
      ['g1', { id: 'g1', host: ME, players: [player(ME, { isHost: true }), player(OTHER)] }],
      ['g2', { id: 'g2', host: ME, players: [player(ME, { isHost: true }), player(OTHER), player('gone', { connected: false })] }]
    ]
  });

  const summary = deleteAccount(ME, s);

  assert.deepEqual(summary.notifySockets, [`sock_${OTHER}`], 'one socket, not one per group');
});

test('deleting an account that owns nothing is a no-op that still succeeds', () => {
  const s = stores({ groups: [['g1', { id: 'g1', host: OTHER, players: [player(OTHER, { isHost: true })] }]] });

  const summary = deleteAccount('never-existed', s);

  assert.equal(summary.profileDeleted, false);
  assert.equal(summary.topicsDeleted, 0);
  assert.deepEqual(summary.groupsDeleted, []);
  assert.ok(s.groups.get('g1'), 'nothing else is disturbed');
});

test('a missing user id is refused rather than silently deleting nothing', () => {
  assert.throws(() => deleteAccount('', stores()), /needs a user id/);
  assert.throws(() => deleteAccount(undefined, stores()), /needs a user id/);
});
