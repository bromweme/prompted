const crypto = require('crypto');

// Group invite codes (UI-2).
//
// A group's id and its invite code are separate things. The id is an opaque
// store key that is never a join secret; the invite code is what a player
// types on the Dashboard or opens as a /join/<CODE> link, and the host can
// replace it at any time.
//
// Code format: INVITE_CODE_LENGTH letters from A-Z, drawn with a CSPRNG
// (crypto.randomInt, which is unbiased). 26^20 is about 94 bits of entropy.
// Clients display it as XXXXX-XXXXX-XXXXX-XXXXX; every lookup goes through
// normalizeInviteCode, so case, spaces and dashes never matter.
//
// Legacy groups (created before UI-2) have no inviteCode. Their invite code is
// their id, normalised the same way, so old codes and old ?join=true links keep
// working until the host resets the code. Normalisation only strips whitespace
// and dashes, never digits or underscores, because legacy ids
// (GROUP<timestamp>_<n>) contain both.

const INVITE_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const INVITE_CODE_LENGTH = 20;
// Generous enough for any legacy id (server LIMITS.id is 200); anything longer
// cannot match a stored code and is rejected before a lookup.
const MAX_INVITE_INPUT_LENGTH = 200;

/**
 * Canonical form of a typed or linked invite code: upper-case, whitespace and
 * dashes removed. Returns null for anything that is not a usable string.
 */
function normalizeInviteCode(input) {
  if (typeof input !== 'string') return null;
  // Cap before the replace too, so a huge payload does no real work.
  if (input.length > MAX_INVITE_INPUT_LENGTH * 4) return null;
  const normalized = input.replace(/[\s-]+/g, '').toUpperCase();
  if (!normalized || normalized.length > MAX_INVITE_INPUT_LENGTH) return null;
  return normalized;
}

function generateInviteCode() {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_CODE_ALPHABET[crypto.randomInt(INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * The in-memory inviteCode -> groupId index.
 *
 * Built once from the groups store at startup and kept current by the
 * create / reset / delete paths. `effectiveCode` is the one place that decides
 * which code a group answers to: its own inviteCode, or (legacy) its id.
 */
function effectiveCode(group) {
  if (!group) return null;
  return normalizeInviteCode(group.inviteCode || group.id);
}

function createInviteIndex() {
  const byCode = new Map();

  return {
    // Adds a group under its effective code. The first group to claim a code
    // keeps it; a later legacy id that happens to normalise to the same key is
    // not reachable by code (new codes are letters only and so can never
    // collide with a legacy id, which always carries digits).
    add(group) {
      const code = effectiveCode(group);
      if (code && !byCode.has(code)) byCode.set(code, group.id);
    },
    // Removes whatever code currently points at this group id.
    remove(group) {
      const code = effectiveCode(group);
      if (code && byCode.get(code) === group.id) byCode.delete(code);
    },
    resolve(input) {
      const code = normalizeInviteCode(input);
      return code ? byCode.get(code) || null : null;
    },
    has(code) {
      return byCode.has(code);
    },
    // A fresh code guaranteed not to be in use.
    issue() {
      for (;;) {
        const code = generateInviteCode();
        if (!byCode.has(code)) return code;
      }
    },
    get size() {
      return byCode.size;
    }
  };
}

/**
 * Sliding-window throttle on failed join attempts, keyed by the authenticated
 * user id. In-memory by design: it is a brake on guessing, not an audit log,
 * and a restart resetting it costs nothing meaningful at 94 bits.
 */
const JOIN_FAILURE_LIMIT = 10;
const JOIN_FAILURE_WINDOW_MS = 60 * 1000;

function createJoinThrottle({ limit = JOIN_FAILURE_LIMIT, windowMs = JOIN_FAILURE_WINDOW_MS, now = Date.now } = {}) {
  const failures = new Map();

  const recent = (key) => {
    const cutoff = now() - windowMs;
    const kept = (failures.get(key) || []).filter((t) => t > cutoff);
    if (kept.length > 0) failures.set(key, kept);
    else failures.delete(key);
    return kept;
  };

  return {
    isBlocked(key) {
      return recent(key).length >= limit;
    },
    recordFailure(key) {
      const kept = recent(key);
      kept.push(now());
      failures.set(key, kept);
    }
  };
}

module.exports = {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  JOIN_FAILURE_LIMIT,
  JOIN_FAILURE_WINDOW_MS,
  normalizeInviteCode,
  generateInviteCode,
  effectiveCode,
  createInviteIndex,
  createJoinThrottle
};
