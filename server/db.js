const path = require('path');
const Database = require('better-sqlite3');

// PROMPTED_DB_PATH lets tests point the server at a throwaway database. Unset,
// it is the same server/prompted.db the app has always used.
const dbPath = process.env.PROMPTED_DB_PATH || path.join(__dirname, 'prompted.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Every store built in this process, so one call can load them all before the
// server starts listening (DB-1).
const stores = [];

// Map-compatible store backed by a SQLite table (one JSON blob per row).
// Keeps an in-memory cache for fast reads and writes through to disk on
// every set()/delete() so callers can keep mutating objects in place and
// just re-set() them when they want the change persisted.
class PersistentStore {
  constructor(tableName) {
    this.tableName = tableName;
    db.exec(`CREATE TABLE IF NOT EXISTS ${tableName} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);

    // Filled by load(), not here: a networked database can't be read from a
    // constructor, and having the lifecycle be the same shape on both drivers
    // is the point of splitting it now (DB-1 phase 1).
    this.cache = new Map();
    this.loaded = false;

    this._upsert = db.prepare(
      `INSERT INTO ${tableName} (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`
    );
    this._delete = db.prepare(`DELETE FROM ${tableName} WHERE id = ?`);

    stores.push(this);
  }

  /**
   * Reads every row into the cache. Async because the next driver's read is,
   * even though SQLite's is not; callers must await it before the first get().
   */
  async load() {
    this.cache = new Map();
    for (const row of db.prepare(`SELECT id, data FROM ${this.tableName}`).all()) {
      this.cache.set(row.id, JSON.parse(row.data));
    }
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
    this._upsert.run(id, JSON.stringify(value));
    return this;
  }

  delete(id) {
    this.cache.delete(id);
    this._delete.run(id);
  }

  forEach(callback) {
    this.cache.forEach(callback);
  }

  values() {
    return this.cache.values();
  }
}

/**
 * Loads every store built so far. Call once, and await it, before anything
 * reads a store — in the server that means before it listens (DB-1).
 * Idempotent: a store already loaded is loaded again from the same source,
 * which is harmless and keeps the call safe for tests to make twice.
 */
async function initStores() {
  await Promise.all(stores.map((store) => store.load()));
  return stores.length;
}

module.exports = { PersistentStore, initStores, db, dbPath };
