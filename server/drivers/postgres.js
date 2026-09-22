const { Pool } = require('pg');

// Postgres driver (DB-1). Used when DATABASE_URL is set, which in production
// it always is: Render's filesystem is ephemeral, so anything written to a
// local file is destroyed on the next spin-down.
//
// The stored shape is deliberately the same as SQLite's — one JSONB blob per
// row, keyed by id — so the two drivers can be checked against each other and
// neither becomes the "real" one by accident.
//
// DATABASE_SCHEMA namespaces the tables. Tests give each run its own schema so
// concurrent runs can share one database without colliding.

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;

/** Table and schema names come from our own code, never from a payload, but
 *  they are interpolated into SQL, so they are checked rather than trusted. */
function assertIdentifier(name, what) {
  if (!IDENTIFIER.test(name)) throw new Error(`Unsafe ${what}: ${name}`);
  return name;
}

function sslFor(connectionString) {
  // Neon and every other managed host present a certificate from a public CA,
  // so verification stays on. PGSSL_NO_VERIFY exists for a self-signed local
  // instance and says plainly what it costs.
  if (process.env.PGSSL_NO_VERIFY === '1') return { rejectUnauthorized: false };
  if (/sslmode=disable/.test(connectionString)) return false;
  if (/^postgres(ql)?:\/\/[^@]*@(localhost|127\.0\.0\.1)[:/]/.test(connectionString)) return false;
  return { rejectUnauthorized: true };
}

// 23505 = unique violation (two CREATE SCHEMA IF NOT EXISTS at once),
// 42P07 = duplicate table (two CREATE TABLE IF NOT EXISTS at once). Both mean
// the object exists, which is all the caller wanted.
const BENIGN_DDL_CODES = new Set(['23505', '42P07']);

async function ignoreAlreadyExists(promise) {
  try {
    await promise;
  } catch (error) {
    if (!BENIGN_DDL_CODES.has(error.code)) throw error;
  }
}

function createPostgresDriver(connectionString) {
  const schema = assertIdentifier(process.env.DATABASE_SCHEMA || 'public', 'schema');
  // Serializes DDL; see ensureTable.
  let ddl = Promise.resolve();
  const pool = new Pool({
    connectionString,
    ssl: sslFor(connectionString),
    // A free instance is small; a handful of connections is plenty for a
    // store whose reads never reach the database.
    max: Number(process.env.PGPOOL_MAX || 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000
  });

  // An idle-client error (the server closing a scaled-to-zero connection, say)
  // is emitted on the pool and would otherwise take the process down.
  pool.on('error', (error) => {
    console.error('[db] idle Postgres client error:', error.message);
  });

  const qualified = (table) => `${schema}.${assertIdentifier(table, 'table')}`;
  const events = qualified('events');

  return {
    kind: 'postgres',
    describe: () => `Postgres (schema ${schema})`,

    async ensureTable(table) {
      // Postgres's CREATE ... IF NOT EXISTS is not atomic: two of them racing
      // hit a unique violation in the catalog rather than one quietly winning.
      // initStores() loads every store at once, so that race is the normal
      // case, not a rare one. DDL therefore runs one statement at a time, and
      // the two "someone else just made it" codes are treated as success.
      ddl = ddl.catch(() => {}).then(async () => {
        if (schema !== 'public') {
          await ignoreAlreadyExists(pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`));
        }
        await ignoreAlreadyExists(pool.query(
          `CREATE TABLE IF NOT EXISTS ${qualified(table)} (id TEXT PRIMARY KEY, data JSONB NOT NULL)`
        ));
      });
      await ddl;
    },

    async loadAll(table) {
      const { rows } = await pool.query(`SELECT id, data FROM ${qualified(table)}`);
      // node-postgres parses jsonb for us, so data is already an object.
      return rows.map((row) => ({ id: row.id, data: row.data }));
    },

    // `json` is already serialized by the store, so what lands in the
    // database is the value as it was at set() time.
    async upsert(table, id, json) {
      await pool.query(
        `INSERT INTO ${qualified(table)} (id, data) VALUES ($1, $2::jsonb)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
        [id, json]
      );
    },

    async remove(table, id) {
      await pool.query(`DELETE FROM ${qualified(table)} WHERE id = $1`, [id]);
    },

    // --- Event log (EVT-1) ---------------------------------------------------
    // Not a PersistentStore: the log is append-only and is never read into
    // memory, so it keeps its own columns rather than one JSON blob per row.

    async ensureEventSchema() {
      // Same serialization as ensureTable, and for the same reason.
      ddl = ddl.catch(() => {}).then(async () => {
        if (schema !== 'public') {
          await ignoreAlreadyExists(pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`));
        }
        // `seq` exists only to order the log. `ts` cannot do it: several events
        // of one round are written in the same millisecond, and Postgres has no
        // rowid to break the tie with.
        await ignoreAlreadyExists(pool.query(`
          CREATE TABLE IF NOT EXISTS ${events} (
            seq BIGSERIAL,
            id TEXT PRIMARY KEY,
            ts BIGINT NOT NULL,
            name TEXT NOT NULL,
            group_id TEXT,
            actor_id TEXT,
            props JSONB
          )
        `));
        for (const [name, columns] of [
          ['events_name_ts', '(name, ts)'],
          ['events_group_id', '(group_id)'],
          ['events_ts', '(ts)']
        ]) {
          await ignoreAlreadyExists(
            pool.query(`CREATE INDEX IF NOT EXISTS ${name} ON ${events} ${columns}`)
          );
        }
      });
      await ddl;
    },

    // `props` arrives already serialized, so a value JSON cannot represent
    // fails in the caller's try block rather than halfway into a write.
    async insertEvent(row) {
      await pool.query(
        `INSERT INTO ${events} (id, ts, name, group_id, actor_id, props)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [row.id, row.ts, row.name, row.groupId, row.actorId, row.props]
      );
    },

    async pruneEvents(cutoffTs) {
      await pool.query(`DELETE FROM ${events} WHERE ts < $1`, [cutoffTs]);
    },

    async readEvents({ groupId } = {}) {
      const scoped = groupId !== undefined && groupId !== null;
      const { rows } = await pool.query(
        `SELECT * FROM ${events}${scoped ? ' WHERE group_id = $1' : ''} ORDER BY seq`,
        scoped ? [groupId] : []
      );
      return rows.map((row) => ({
        id: row.id,
        // BIGINT comes back as a string; callers compare it with Date.now().
        ts: Number(row.ts),
        name: row.name,
        groupId: row.group_id,
        actorId: row.actor_id,
        props: row.props ?? null
      }));
    },

    async close() {
      await pool.end();
    },

    // Test-only: lets a run clean up the schema it created.
    async dropSchema() {
      if (schema === 'public') throw new Error('refusing to drop the public schema');
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
  };
}

module.exports = { createPostgresDriver };
