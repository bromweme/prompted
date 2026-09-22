const { createSqliteDriver } = require('./drivers/sqlite');
const { createPostgresDriver } = require('./drivers/postgres');

// Storage for the whole app (DB-1). One interface, two drivers:
//
//   DATABASE_URL set  -> Postgres. What production runs, because Render's
//                        filesystem is ephemeral and a local file is destroyed
//                        on every spin-down.
//   DATABASE_URL unset -> SQLite. A checkout still runs with no setup.
//
// Both are exercised: the suite runs on SQLite locally and on Postgres in CI,
// so neither path can quietly rot.
//
// The event log (EVT-1) is not a PersistentStore — it is append-only and never
// cached — but it goes through the same driver, so it lives wherever the rest
// of the data does. See events.js.

const connectionString = process.env.DATABASE_URL || null;
const driver = connectionString
  ? createPostgresDriver(connectionString)
  : createSqliteDriver();

// Every store built in this process, so one call can load them all before the
// server starts listening.
const stores = [];

/**
 * Map-compatible store over one table of JSON blobs.
 *
 * Reads are synchronous and come from an in-memory cache, which is what lets
 * every socket handler stay synchronous whatever backs the store. Writes update
 * the cache immediately and reach the database behind a per-key queue: two
 * writes to the same id keep their order, while unrelated groups never wait on
 * each other.
 *
 * A write is not awaited by its caller. The window where a crash could lose the
 * last change is milliseconds, and closing it would mean making every handler
 * async — a poor trade for a party game's state. Failures are retried once and
 * then logged loudly; flush() waits for the writes still in flight.
 */
class PersistentStore {
  constructor(tableName) {
    this.tableName = tableName;
    this.cache = new Map();
    this.loaded = false;
    this.writeFailures = 0;
    // id -> promise for the last queued write to that id.
    this._writes = new Map();
    stores.push(this);
  }

  /** Creates the table if needed and reads every row into the cache. */
  async load() {
    await driver.ensureTable(this.tableName);
    const rows = await driver.loadAll(this.tableName);
    this.cache = new Map(rows.map((row) => [row.id, row.data]));
    this.loaded = true;
    return this;
  }

  get(id) {
    return this.cache.get(id);
  }

  has(id) {
    return this.cache.has(id);
  }

  set(id, value) {
    this.cache.set(id, value);
    // Serialized here, not when the write reaches the database. Callers mutate
    // a group in place and re-set() it, so a late serialization would persist
    // whatever the object had become by then — including a half-applied change
    // from a later handler. This costs exactly what the old synchronous write
    // cost, and makes set() mean "record it as it is now".
    const snapshot = JSON.stringify(value);
    this._enqueue(id, () => driver.upsert(this.tableName, id, snapshot));
    return this;
  }

  delete(id) {
    this.cache.delete(id);
    this._enqueue(id, () => driver.remove(this.tableName, id));
  }

  forEach(callback) {
    this.cache.forEach(callback);
  }

  values() {
    return this.cache.values();
  }

  /** Resolves once every write queued so far has settled. */
  async flush() {
    await Promise.all([...this._writes.values()]);
  }

  _enqueue(id, work) {
    const previous = this._writes.get(id) || Promise.resolve();
    const next = previous
      .catch(() => {}) // a failed earlier write must not cancel this one
      .then(() => this._run(work));
    this._writes.set(id, next);
    // Drop the entry once it is the last one for this id, so the map doesn't
    // grow for the life of the process.
    next.finally(() => {
      if (this._writes.get(id) === next) this._writes.delete(id);
    });
    return next;
  }

  async _run(work) {
    try {
      await work();
    } catch (first) {
      // One retry: a scaled-to-zero database waking up, or a connection the
      // server closed while idle, both look like this and both succeed second.
      await new Promise((resolve) => setTimeout(resolve, 250));
      try {
        await work();
      } catch (second) {
        this.writeFailures += 1;
        console.error(`[db] write to ${this.tableName} failed twice: ${second.message}`);
      }
    }
  }
}

/**
 * Loads every store built so far. Call once, and await it, before anything
 * reads a store — in the server that means before it listens.
 */
async function initStores() {
  await Promise.all(stores.map((store) => store.load()));
  return stores.length;
}

/** Waits for every store's queued writes. Used on shutdown and by tests. */
async function flushStores() {
  await Promise.all(stores.map((store) => store.flush()));
}

module.exports = {
  PersistentStore,
  initStores,
  flushStores,
  driver
};
