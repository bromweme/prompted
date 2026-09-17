const crypto = require('crypto');
const { db } = require('./db');

// First-party game event log (EVT-1).
//
// An append-only table of lifecycle and feature-use events, so product
// questions ("do groups finish a round?", "is the vote budget used?") can be
// answered from data. It lives in the same SQLite database as everything else;
// nothing leaves the server and no cookie or third-party script is involved.
//
// What is stored, and what is deliberately not:
// - `name`: the event name (a fixed string from server.js).
// - `group_id`: the group's opaque generated id.
// - `actor_id`: HMAC-SHA256 of the acting user's id, never the raw id. The
//   secret is EVENTS_HASH_SECRET when set, otherwise a random one generated
//   once and kept in the `meta` table, so hashes stay stable across restarts
//   (and can still be joined across events) without the log naming anyone.
// - `props`: JSON of ids, enums, numbers, booleans and lists of setting KEY
//   names only. Never names, emails, group names, topic text, video titles or
//   urls, or comments. Callers in server.js are responsible for passing only
//   those shapes; this module does not inspect props.
//
// Retention: 12 months. Rows older than RETENTION_MS are deleted
// opportunistically from logEvent, at most once every PRUNE_INTERVAL_MS. That
// matches the rest of the server's evaluate-on-write/read, no-scheduler design:
// an idle server keeps old rows a little longer, and the first event after it
// wakes up prunes them.
//
// Failure model: logEvent is fire-and-forget. It never throws and returns
// nothing, so a broken log (disk full, locked db, bad props) can never change
// the outcome of the game action that triggered it. Failures are reported with
// a rate-limited console.warn.
//
// Switches:
// - EVENTS_DISABLED=1 skips every write (ops / tests that don't want rows).
// - EVENTS_HASH_SECRET sets the actor-id HMAC secret.

const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const WARN_INTERVAL_MS = 10 * 60 * 1000;

let statements = null;
let hashSecret = null;
let lastPruneAt = 0;
let lastWarnAt = 0;
let suppressedWarnings = 0;

function init() {
  if (statements) return statements;

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
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);

  hashSecret = process.env.EVENTS_HASH_SECRET || null;
  if (!hashSecret) {
    // INSERT OR IGNORE then read back: the first boot writes the secret, every
    // later boot keeps the one already there.
    db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)')
      .run('events_hash_secret', crypto.randomBytes(32).toString('hex'));
    hashSecret = db.prepare('SELECT value FROM meta WHERE key = ?').get('events_hash_secret').value;
  }

  statements = {
    insert: db.prepare('INSERT INTO events (id, ts, name, group_id, actor_id, props) VALUES (?, ?, ?, ?, ?, ?)'),
    prune: db.prepare('DELETE FROM events WHERE ts < ?')
  };
  return statements;
}

function hashActor(userId) {
  if (userId === undefined || userId === null || userId === '') return null;
  init();
  return crypto.createHmac('sha256', hashSecret).update(String(userId)).digest('hex');
}

function warn(err) {
  const now = Date.now();
  if (now - lastWarnAt < WARN_INTERVAL_MS) {
    suppressedWarnings++;
    return;
  }
  const extra = suppressedWarnings > 0 ? ` (${suppressedWarnings} earlier failure(s) not shown)` : '';
  lastWarnAt = now;
  suppressedWarnings = 0;
  console.warn(`[events] Failed to record an event: ${err && err.message}${extra}`);
}

function maybePrune(stmts, now) {
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  stmts.prune.run(now - RETENTION_MS);
}

/**
 * Records one event. Fire-and-forget: never throws, returns nothing.
 *
 * @param {string} name   event name
 * @param {object} [data] { groupId, actorId, ...props } — actorId is the raw
 *                        user id and is hashed before storage; everything else
 *                        becomes the JSON `props` column.
 */
function logEvent(name, data) {
  if (process.env.EVENTS_DISABLED === '1') return;
  try {
    const { groupId = null, actorId = null, ...props } = data || {};
    const stmts = init();
    const now = Date.now();
    const propsJson = Object.keys(props).length > 0 ? JSON.stringify(props) : null;
    stmts.insert.run(
      crypto.randomUUID(),
      now,
      String(name),
      groupId === null ? null : String(groupId),
      hashActor(actorId),
      propsJson
    );
    maybePrune(stmts, now);
  } catch (err) {
    warn(err);
  }
}

// Group settings that are safe to name (and, for number/boolean values, to
// record) in an event. The settings object is client-supplied, so its keys are
// filtered against this list rather than trusted: a crafted client could
// otherwise smuggle free text into the log as a key name.
const SETTING_KEYS = new Set([
  'totalRounds', 'maxPlayers', 'czarPoints', 'allowSkipCzar', 'anonymousCzar',
  'maxJuryPoints', 'allowDownvotes', 'downvoteCost', 'voteBudget',
  'shareTheWealth', 'allowOverride', 'overrideThreshold', 'submissionTime',
  'votingTime', 'autoStart', 'topicSelection', 'allowCustomTopics',
  'allowMemberInvites', 'allowVotingComments', 'showCommentsLive',
  'enableChat', 'enableSongPreview', 'showVoterIdentity'
]);

// Allowlisted settings whose value is a number or boolean, for a snapshot of a
// new group's configuration. String values are dropped.
function settingsSnapshot(settings) {
  const out = {};
  for (const [key, value] of Object.entries(settings || {})) {
    if (!SETTING_KEYS.has(key)) continue;
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      out[key] = value;
    }
  }
  return out;
}

// Allowlisted setting keys whose value differs between two settings objects.
// Only the key names are returned, never the values.
function changedSettingKeys(before, after) {
  const a = before || {};
  const b = after || {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return Array.from(keys)
    .filter((key) => SETTING_KEYS.has(key) && JSON.stringify(a[key]) !== JSON.stringify(b[key]))
    .sort();
}

module.exports = {
  logEvent,
  hashActor,
  settingsSnapshot,
  changedSettingKeys,
  RETENTION_MS,
  PRUNE_INTERVAL_MS,
  // Test seam: lets a unit test re-run the opportunistic prune immediately.
  _resetPruneClock: () => { lastPruneAt = 0; }
};
