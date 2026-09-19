const test = require('node:test');
const assert = require('node:assert');

const {
  INVITE_CODE_LENGTH,
  normalizeInviteCode,
  generateInviteCode,
  createInviteIndex,
  createJoinThrottle
} = require('../invites');

test('generated codes are 20 letters from A-Z and do not repeat', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const code = generateInviteCode();
    assert.match(code, /^[A-Z]{20}$/);
    seen.add(code);
  }
  assert.strictEqual(INVITE_CODE_LENGTH, 20);
  assert.strictEqual(seen.size, 500);
});

test('normalizeInviteCode upper-cases and strips only whitespace and dashes', () => {
  assert.strictEqual(normalizeInviteCode('abcde-fghij-klmno-pqrst'), 'ABCDEFGHIJKLMNOPQRST');
  assert.strictEqual(normalizeInviteCode('  abcde fghij\tklmno - pqrst '), 'ABCDEFGHIJKLMNOPQRST');
  // Legacy ids keep their digits and underscores.
  assert.strictEqual(normalizeInviteCode('GROUP1789077058154_1'), 'GROUP1789077058154_1');
  assert.strictEqual(normalizeInviteCode('group1789077058154_1'), 'GROUP1789077058154_1');
});

test('normalizeInviteCode rejects non-strings, empty and oversized input', () => {
  for (const bad of [undefined, null, 42, {}, ['ABC'], '', '   ', '---', 'A'.repeat(201), ' '.repeat(10_000)]) {
    assert.strictEqual(normalizeInviteCode(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
  assert.strictEqual(normalizeInviteCode('A'.repeat(200)), 'A'.repeat(200));
});

test('the index resolves new codes and legacy ids, and forgets removed ones', () => {
  const index = createInviteIndex();
  const modern = { id: '0b8f7a4e-1111-4222-8333-444455556666', inviteCode: 'ABCDEFGHIJKLMNOPQRST' };
  const legacy = { id: 'GROUP1789077058154_1' };
  index.add(modern);
  index.add(legacy);

  assert.strictEqual(index.resolve('abcde-fghij-klmno-pqrst'), modern.id);
  assert.strictEqual(index.resolve('group1789077058154_1'), legacy.id);
  // A modern group is never reachable by its id.
  assert.strictEqual(index.resolve(modern.id), null);
  assert.strictEqual(index.resolve('NOPE'), null);
  assert.strictEqual(index.resolve(undefined), null);

  // Reset: remove under the old code, re-add under the new one.
  index.remove(legacy);
  legacy.inviteCode = index.issue();
  index.add(legacy);
  assert.strictEqual(index.resolve('GROUP1789077058154_1'), null);
  assert.strictEqual(index.resolve(legacy.inviteCode), legacy.id);

  index.remove(modern);
  assert.strictEqual(index.resolve(modern.inviteCode), null);
});

test('the join throttle blocks after the limit and recovers after the window', () => {
  let clock = 1_000_000;
  const throttle = createJoinThrottle({ limit: 3, windowMs: 60_000, now: () => clock });

  for (let i = 0; i < 3; i++) {
    assert.strictEqual(throttle.isBlocked('u1'), false);
    throttle.recordFailure('u1');
  }
  assert.strictEqual(throttle.isBlocked('u1'), true);
  // Per user.
  assert.strictEqual(throttle.isBlocked('u2'), false);

  clock += 60_001;
  assert.strictEqual(throttle.isBlocked('u1'), false);
});
