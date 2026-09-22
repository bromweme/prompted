// Unit tests for the store (DB-1). Run with `npm test`.
//
// What matters here is that written state really reaches the database and
// comes back on a fresh start — the thing an in-memory-only store would pass
// every other test in the repo without doing.
//
// These run against whichever driver is configured, so the same assertions
// cover SQLite locally and Postgres in CI:
//
//   npm test                                          # SQLite
//   DATABASE_URL=postgres://... DATABASE_SCHEMA=t1 npm test   # Postgres
//
// With no DATABASE_URL, PROMPTED_DB_PATH points at a throwaway file so the
// real server/prompted.db is never opened.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const usingPostgres = !!process.env.DATABASE_URL;
let tmpDir = null;
if (!usingPostgres) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompted-persistence-'));
  process.env.PROMPTED_DB_PATH = path.join(tmpDir, 'persistence-test.db');
} else if (!process.env.DATABASE_SCHEMA || process.env.DATABASE_SCHEMA === 'public') {
  // Never let a test run loose in the default schema of a real database.
  process.env.DATABASE_SCHEMA = `test_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const { PersistentStore, initStores, flushStores, driver } = require('../db');

after(async () => {
  if (usingPostgres) await driver.dropSchema();
  await driver.close();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

test(`driver selection follows DATABASE_URL (running on ${usingPostgres ? 'postgres' : 'sqlite'})`, () => {
  assert.equal(driver.kind, usingPostgres ? 'postgres' : 'sqlite');
});

test('a store starts empty and load() fills it from the database', async () => {
  const first = await new PersistentStore('lifecycle_demo').load();
  first.set('g1', { name: 'Kept', players: [{ userId: 'u1' }] });
  await first.flush();

  // A second store over the same table stands in for a restart: same rows in
  // the database, a cache that knows nothing yet.
  const restarted = new PersistentStore('lifecycle_demo');
  assert.equal(restarted.loaded, false);
  assert.equal(restarted.get('g1'), undefined, 'reads before load() must not see stored rows');

  await restarted.load();
  assert.equal(restarted.loaded, true);
  assert.deepEqual(restarted.get('g1'), { name: 'Kept', players: [{ userId: 'u1' }] });
  assert.equal(first.writeFailures, 0);
});

test('deletes survive a restart too', async () => {
  const store = await new PersistentStore('delete_demo').load();
  store.set('a', { keep: false });
  store.set('b', { keep: true });
  store.delete('a');
  await store.flush();

  const restarted = await new PersistentStore('delete_demo').load();
  assert.equal(restarted.has('a'), false);
  assert.deepEqual(restarted.get('b'), { keep: true });
});

test('writes to one id keep their order', async () => {
  const store = await new PersistentStore('ordering_demo').load();
  for (let round = 1; round <= 10; round += 1) {
    store.set('game', { round });
  }
  await store.flush();

  const restarted = await new PersistentStore('ordering_demo').load();
  assert.deepEqual(restarted.get('game'), { round: 10 }, 'the last write must win');
});

test('a set records the value as it was, not as it is later mutated', async () => {
  const store = await new PersistentStore('snapshot_demo').load();
  const group = { round: 1 };
  store.set('g', group);
  group.round = 2; // mutated after the set, before the write lands
  await store.flush();

  const restarted = await new PersistentStore('snapshot_demo').load();
  assert.deepEqual(restarted.get('g'), { round: 1 })
  store.set('g', group);
  await store.flush();
  assert.deepEqual((await new PersistentStore('snapshot_demo').load()).get('g'), { round: 2 })
});

test('initStores loads every store built in this process', async () => {
  const one = new PersistentStore('init_one');
  const two = new PersistentStore('init_two');
  await one.load();
  one.set('x', { from: 'one' });
  await one.flush();
  await two.load();
  two.set('y', { from: 'two' });
  await flushStores();

  const loaded = await initStores();
  assert.ok(loaded >= 2, 'every store registers itself');
  assert.deepEqual(one.get('x'), { from: 'one' });
  assert.deepEqual(two.get('y'), { from: 'two' });
});

test('values and forEach read the loaded cache', async () => {
  const store = await new PersistentStore('iteration_demo').load();
  store.set('one', { n: 1 });
  store.set('two', { n: 2 });
  await store.flush();

  const restarted = await new PersistentStore('iteration_demo').load();
  const seen = [];
  restarted.forEach((value, id) => seen.push([id, value.n]));
  assert.deepEqual(seen.sort(), [['one', 1], ['two', 2]]);
  assert.equal(Array.from(restarted.values()).length, 2);
});
