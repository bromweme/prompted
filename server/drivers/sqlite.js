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
  // Prepared once by ensureEventSchema; the event log is a single fixed table.
  let events = null;

  return {
    kind: 'sqlite',
    describe: () => `SQLite at ${dbPath}`,

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

    // --- Event log (EVT-1) ---------------------------------------------------
    // Not a PersistentStore: the log is append-only and is never read into
    // memory, so it keeps its own columns rather than one JSON blob per row.

    async ensureEventSchema() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          ts INTEGER NOT NULL,
          name TEXT NOT NULL,
          group_id TEXT,
          actor_id TEXT,
          props TEXT
        );
        CREATE INDEX IF NOT EXISTS events_name_ts ON events (name, ts);
        CREATE INDEX IF NOT EXISTS events_group_id ON events (group_id);
        CREATE INDEX IF NOT EXISTS events_ts ON events (ts);
      `);
      events = {
        insert: db.prepare(
          'INSERT INTO events (id, ts, name, group_id, actor_id, props) VALUES (?, ?, ?, ?, ?, ?)'
        ),
        prune: db.prepare('DELETE FROM events WHERE ts < ?'),
        // Erasure by actor (PRIV-1). actor_id is already an HMAC, so the
        // caller hashes the raw user id the same way logEvent did.
        deleteActor: db.prepare('DELETE FROM events WHERE actor_id = ?'),
        // rowid is the insertion order, which `ts` alone does not give: several
        // events of one round land in the same millisecond.
        readAll: db.prepare('SELECT * FROM events ORDER BY rowid'),
        readGroup: db.prepare('SELECT * FROM events WHERE group_id = ? ORDER BY rowid')
      };
    },

    // `props` arrives already serialized, so a value JSON cannot represent
    // fails in the caller's try block rather than halfway into a write.
    async insertEvent(row) {
      events.insert.run(row.id, row.ts, row.name, row.groupId, row.actorId, row.props);
    },

    async pruneEvents(cutoffTs) {
      events.prune.run(cutoffTs);
    },

    async deleteEventsByActor(actorId) {
      return events.deleteActor.run(actorId).changes;
    },

    async readEvents({ groupId } = {}) {
      const rows = groupId === undefined || groupId === null
        ? events.readAll.all()
        : events.readGroup.all(groupId);
      return rows.map((row) => ({
        id: row.id,
        ts: row.ts,
        name: row.name,
        groupId: row.group_id,
        actorId: row.actor_id,
        props: row.props ? JSON.parse(row.props) : null
      }));
    },

    async close() {
      db.close();
    }
  };
}

module.exports = { createSqliteDriver };
