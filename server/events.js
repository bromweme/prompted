const crypto = require('crypto');
const config = require('./config');
const { driver } = require('./db');

// First-party game event log (EVT-1).
//
// An append-only table of lifecycle and feature-use events, so product
// questions ("do groups finish a round?", "is the vote budget used?") can be
// answered from data. It goes through the same driver as everything else
// (DB-1), so it lives in Postgres in production and in the local SQLite file
// otherwise; nothing leaves the server and no cookie or third-party script is
// involved.
//
// What is stored, and what is deliberately not:
// - `name`: the event name (a fixed string from server.js).
// - `group_id`: the group's opaque generated id.
// - `actor_id`: HMAC-SHA256 of the acting user's id, never the raw id. The
//   secret is EVENTS_HASH_SECRET (see config.js), so the same player hashes to
//   the same actor id for as long as that variable is set — across restarts and
//   across a database that was wiped underneath us — without the log naming
//   anyone.
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
// nothing, so a broken log (database down, locked file, bad props) can never
// change the outcome of the game action that triggered it. Failures are
// reported with a rate-limited console.warn.
//
// Switches:
// - EVENTS_DISABLED=1 skips every write (ops / tests that don't want rows).
// - EVENTS_HASH_SECRET sets the actor-id HMAC secret.

const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const WARN_INTERVAL_MS = 10 * 60 * 1000;

let schemaReady = null;
// The tail of the write chain; see logEvent.
let writes = Promise.resolve();
let lastPruneAt = 0;
let lastWarnAt = 0;
let suppressedWarnings = 0;

/** Creates the tables once, and lets a later call retry if that failed. */
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = driver.ensureEventSchema().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

function hashActor(userId) {
  if (userId === undefined || userId === null || userId === '') return null;
  return crypto.createHmac('sha256', config.eventsHashSecret).update(String(userId)).digest('hex');
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

async function maybePrune(now) {
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  await driver.pruneEvents(now - RETENTION_MS);
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
    const now = Date.now();
    // The row is built here, synchronously, so that a props value JSON cannot
    // represent is caught by this try rather than surfacing much later as an
    // unhandled rejection.
    const row = {
      id: crypto.randomUUID(),
      ts: now,
      name: String(name),
      groupId: groupId === null ? null : String(groupId),
      actorId: hashActor(actorId),
      props: Object.keys(props).length > 0 ? JSON.stringify(props) : null
    };
    // Writes are queued behind one another rather than fired off in parallel.
    // The order rows were written is part of what the log records — a round's
    // events routinely land in the same millisecond, so `ts` cannot recover it
    // and the insertion order is the only thing that can.
    writes = writes.then(async () => {
      await ensureSchema();
      await driver.insertEvent(row);
      await maybePrune(row.ts);
    }).catch(warn);
  } catch (err) {
    warn(err);
  }
}

/** Resolves once every event queued so far has been written (or has failed). */
async function flushEvents() {
  let awaited = null;
  // A write can queue another; loop until the tail stops moving.
  while (awaited !== writes) {
    awaited = writes;
    await awaited.catch(() => {});
  }
}

/**
 * Reads the log back in insertion order, newest last. The only read path there
 * is: the log exists to be queried, and until DB-1 nothing could.
 *
 * @param {object} [options] { groupId } — omit groupId for the whole log.
 * @returns {Promise<Array>} rows as { id, ts, name, groupId, actorId, props }
 */
async function readEvents(options = {}) {
  await ensureSchema();
  return driver.readEvents(options);
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
  readEvents,
  flushEvents,
  hashActor,
  settingsSnapshot,
  changedSettingKeys,
  RETENTION_MS,
  PRUNE_INTERVAL_MS,
  // Test seam: lets a unit test re-run the opportunistic prune immediately.
  _resetPruneClock: () => { lastPruneAt = 0; }
};
