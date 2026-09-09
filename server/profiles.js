const { PersistentStore } = require('./db');

// Player profiles, keyed by the verified Google `sub`. Separate from the
// identity Google hands us: `displayName` starts as the Google name but is
// the player's to change, and `avatar` is ours entirely.
const users = new PersistentStore('users');

// The canonical avatar set. It lives here rather than in the client so there
// is exactly one list: the server validates against it and ships it to the
// client in the session payload, which is what the pickers render from.
// Emoji only — no image assets, and React escapes them on render.
const AVATAR_CHOICES = [
  // Music
  '🎵', '🎶', '🎸', '🎹', '🎤', '🎧', '🎻', '🥁', '🎷', '🎺', '🪕', '🪗',
  // Faces and characters
  '😀', '😎', '🤠', '🥳', '🤖', '👽', '👻', '🦸', '🧙', '🧛', '🧜', '🦹',
  // Animals
  '🐶', '🐱', '🦊', '🐼', '🐨', '🦁', '🐯', '🐸', '🐙', '🦉', '🦄', '🐝',
  // Objects and misc
  '🚀', '🌈', '⭐', '🔥', '🌮', '🍕', '☕', '🎲', '🎯', '🏆', '💎', '🌙'
];

const AVATAR_SET = new Set(AVATAR_CHOICES);

function nowIso() {
  return new Date().toISOString();
}

/**
 * Returns the stored profile for a verified user, creating it on first sign-in.
 * `avatar` is deliberately left null for a new profile — that null is what the
 * client uses to tell a first-time player from a returning one.
 */
function getOrCreateProfile(userId, googleName, initialAvatar) {
  const existing = users.get(userId);
  if (existing) return existing;

  const profile = {
    userId,
    displayName: googleName || 'Player',
    // Normally null, which is what makes the client run first-time setup.
    // An initial avatar only ever arrives from the AUTH_TEST_MODE identity
    // seam, so the suite can start from an already-set-up player; it is
    // validated against the same allowlist as any other avatar.
    avatar: AVATAR_SET.has(initialAvatar) ? initialAvatar : null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  users.set(userId, profile);
  console.log('Created profile for new user:', userId);
  return profile;
}

/**
 * Applies a partial profile update. Returns { profile } on success or
 * { error } with a message to send back — callers never persist a value this
 * hasn't accepted.
 */
function updateProfile(userId, { displayName, avatar }, maxNameLength) {
  const profile = users.get(userId);
  if (!profile) return { error: 'Profile not found' };

  const updated = { ...profile };

  if (displayName !== undefined) {
    const name = typeof displayName === 'string' ? displayName.trim() : '';
    if (!name || name.length > maxNameLength) {
      return { error: `Display name is required and must be at most ${maxNameLength} characters` };
    }
    updated.displayName = name;
  }

  if (avatar !== undefined) {
    // An allowlist rather than a length check: the avatar is rendered for
    // every other player in the group, so only values we ship are storable.
    if (!AVATAR_SET.has(avatar)) {
      return { error: 'That is not one of the available avatars' };
    }
    updated.avatar = avatar;
  }

  updated.updatedAt = nowIso();
  users.set(userId, updated);
  return { profile: updated };
}

module.exports = { getOrCreateProfile, updateProfile, AVATAR_CHOICES };
