const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, 'prompted.db'));
db.pragma('journal_mode = WAL');

// Map-compatible store backed by a SQLite table (one JSON blob per row).
// Keeps an in-memory cache for fast reads and writes through to disk on
// every set()/delete() so callers can keep mutating objects in place and
// just re-set() them when they want the change persisted.
class PersistentStore {
  constructor(tableName) {
    this.tableName = tableName;
    db.exec(`CREATE TABLE IF NOT EXISTS ${tableName} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);

    this.cache = new Map();
    for (const row of db.prepare(`SELECT id, data FROM ${tableName}`).all()) {
      this.cache.set(row.id, JSON.parse(row.data));
    }

    this._upsert = db.prepare(
      `INSERT INTO ${tableName} (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`
    );
    this._delete = db.prepare(`DELETE FROM ${tableName} WHERE id = ?`);
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

module.exports = { PersistentStore };
