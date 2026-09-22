// Unit tests for the store's lifecycle (DB-1 phase 1). Run with `npm test`.
//
// What matters here is that written state really reaches the database and
// comes back on a fresh start — the thing an in-memory-only store would pass
// every other test in the repo without doing. A store now starts empty and is
// filled by load(), so these also pin the rule that nothing may read a store
// before initStores() has been awaited.
//
// Throwaway database in the OS temp directory: PROMPTED_DB_PATH is set before
// db.js is first required, so the real server/prompted.db is never opened.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompted-persistence-'));
process.env.PROMPTED_DB_PATH = path.join(tmpDir, 'persistence-test.db');

const { PersistentStore, initStores, db } = require('../db');

after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('a store starts empty and load() fills it from the database', async () => {
  const first = new PersistentStore('lifecycle_demo');
  await first.load();
  first.set('g1', { name: 'Kept', players: [{ userId: 'u1' }] });

  // A second store over the same table stands in for a restart: same rows on
  // disk, a cache that knows nothing yet.
  const restarted = new PersistentStore('lifecycle_demo');
  assert.equal(restarted.loaded, false);
  assert.equal(restarted.get('g1'), undefined, 'reads before load() must not see stored rows');

  await restarted.load();
  assert.equal(restarted.loaded, true);
  assert.deepEqual(restarted.get('g1'), { name: 'Kept', players: [{ userId: 'u1' }] });
});

test('deletes survive a restart too', async () => {
  const store = new PersistentStore('delete_demo');
  await store.load();
  store.set('a', { keep: false });
  store.set('b', { keep: true });
  store.delete('a');

  const restarted = await new PersistentStore('delete_demo').load();
  assert.equal(restarted.has('a'), false);
  assert.deepEqual(restarted.get('b'), { keep: true });
});

test('initStores loads every store built in this process', async () => {
  const one = new PersistentStore('init_one');
  const two = new PersistentStore('init_two');
  await one.load();
  one.set('x', { from: 'one' });
  two.set('y', { from: 'two' }); // written before either was loaded

  const loaded = await initStores();
  assert.ok(loaded >= 2, 'every store registers itself');
  assert.deepEqual(one.get('x'), { from: 'one' });
  assert.deepEqual(two.get('y'), { from: 'two' });
});

test('values and forEach read the loaded cache', async () => {
  const store = new PersistentStore('iteration_demo');
  await store.load();
  store.set('one', { n: 1 });
  store.set('two', { n: 2 });

  const restarted = await new PersistentStore('iteration_demo').load();
  const seen = [];
  restarted.forEach((value, id) => seen.push([id, value.n]));
  assert.deepEqual(seen.sort(), [['one', 1], ['two', 2]]);
  assert.equal(Array.from(restarted.values()).length, 2);
});
