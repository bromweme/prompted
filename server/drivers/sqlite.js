const path = require('path');
const Database = require('better-sqlite3');

// SQLite driver (DB-1). The default: with no DATABASE_URL, the server, the
// tests and a local checkout all keep working with no setup at all.
//
// PROMPTED_DB_PATH lets tests point at a throwaway file. Unset, it is the same
// server/prompted.db the app has always used.

function createSqliteDriver() {
  const dbPath = process.env.PROMPTED_DB_PATH || path.join(__dirname, '..', 'prompted.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // One prepared statement pair per table, made when the table is ensured.
  const statements = new Map();

  return {
    kind: 'sqlite',
    describe: () => `SQLite at ${dbPath}`,
    // Exposed for events.js, which still speaks raw SQL (ported in phase 3).
    handle: db,
    dbPath,

    async ensureTable(table) {
      db.exec(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
      statements.set(table, {
        upsert: db.prepare(
          `INSERT INTO ${table} (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`
        ),
        remove: db.prepare(`DELETE FROM ${table} WHERE id = ?`)
      });
    },

    async loadAll(table) {
      return db.prepare(`SELECT id, data FROM ${table}`).all()
        .map((row) => ({ id: row.id, data: JSON.parse(row.data) }));
    },

    // `json` is already serialized by the store, so what lands in the
    // database is the value as it was at set() time.
    async upsert(table, id, json) {
      statements.get(table).upsert.run(id, json);
    },

    async remove(table, id) {
      statements.get(table).remove.run(id);
    },

    async close() {
      db.close();
    }
  };
}

module.exports = { createSqliteDriver };
