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

  return {
    kind: 'postgres',
    describe: () => `Postgres (schema ${schema})`,
    handle: null,
    dbPath: null,

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
