const crypto = require('crypto');

/**
 * Account deletion (PRIV-1).
 *
 * A privacy policy may only promise erasure if something actually erases, so
 * this is the code that policy describes. It is deliberately a separate module
 * with its stores injected: deletion touches nearly every collection the app
 * has, and that is far easier to test directly than through a socket.
 *
 * Three rules shape everything below.
 *
 * 1. **Erase what is theirs; anonymise what is shared.** A profile, a topic
 *    and a notification belong to one person and are deleted outright. A round
 *    someone else played in does not: deleting its submissions and votes would
 *    silently rewrite other players' scores and history. Those records lose
 *    their owner instead of their existence.
 *
 * 2. **Never strand a group.** The host is a group's only point of management,
 *    and `leave_group` refuses to let a host out for exactly that reason.
 *    Deletion cannot refuse, so it hands the group to the longest-standing
 *    remaining member, and deletes a hosted group only when nobody else is in
 *    it. Destroying other people's group because one member left would be the
 *    worse failure.
 *
 * 3. **A ban outlives the account.** Bans are kept. Google returns the same
 *    `sub` for the same account forever, so clearing them would turn account
 *    deletion into a way to evade moderation. This is the one place a deleted
 *    user's id deliberately survives, and the policy says so rather than
 *    quietly making an exception.
 */

// A per-deletion tombstone, so anonymised records stay distinct from each
// other. A single shared 'deleted' sentinel would merge two deleted players
// into one identity, which would corrupt per-user round maths like
// voteBudgetUsed and the self-vote check.
function tombstoneId() {
  return `deleted_${crypto.randomBytes(8).toString('hex')}`;
}

const DELETED_NAME = 'Deleted player';

// Replaces one user's fingerprints on a single round, live or historical.
function anonymiseTheme(theme, userId, tomb) {
  if (!theme || typeof theme !== 'object') return false;
  let touched = false;

  for (const submission of theme.submissions || []) {
    if (submission.playerUserId === userId) {
      submission.playerUserId = tomb;
      touched = true;
    }
  }

  for (const vote of theme.votes || []) {
    if (vote.voterUserId === userId) {
      vote.voterUserId = tomb;
      touched = true;
    }
  }

  // Keyed by user id, so the key itself is the identifier to replace.
  if (theme.voteBudgetUsed && Object.prototype.hasOwnProperty.call(theme.voteBudgetUsed, userId)) {
    theme.voteBudgetUsed[tomb] = theme.voteBudgetUsed[userId];
    delete theme.voteBudgetUsed[userId];
    touched = true;
  }

  if (theme.judgeUserId === userId) {
    theme.judgeUserId = tomb;
    touched = true;
  }
  if (theme.winnerUserId === userId) {
    theme.winnerUserId = tomb;
    touched = true;
  }

  return touched;
}

/**
 * Deletes a user and everything attributable to them.
 *
 * Synchronous over the write-through stores on purpose: `PersistentStore` reads
 * from memory and queues its writes, so this either completes against every
 * store or throws before any socket has been told the account is gone.
 *
 * @param {string} userId the verified Google `sub`
 * @param {object} stores { groups, topics, notifications, users, inviteIndex }
 * @returns {object} a summary, for logging and for the caller's tests
 */
function deleteAccount(userId, stores) {
  const { groups, topics, notifications, users, inviteIndex } = stores;
  if (!userId) throw new Error('deleteAccount needs a user id');

  const tomb = tombstoneId();
  const summary = {
    tombstone: tomb,
    groupsDeleted: [],
    // The same groups as objects: the caller needs them to drop each one from
    // the open-groups index, which reads fields the id alone does not carry.
    removedGroups: [],
    groupsRehosted: [],
    groupsLeft: [],
    groupsAnonymised: [],
    topicsDeleted: 0,
    notificationsDeleted: false,
    profileDeleted: false,
    notifySockets: []
  };

  // --- groups -------------------------------------------------------------
  // Every group is visited, not just the ones they are currently in: a round
  // they played months ago still carries their id in another group's history.
  // Snapshotted, because hosted groups with nobody left are deleted mid-loop.
  for (const group of Array.from(groups.values())) {
    const gid = group.id;
    let changed = false;

    const isMember = (group.players || []).some(p => p.userId === userId);
    const isHost = group.host === userId;

    if (isMember || isHost) {
      const remaining = (group.players || []).filter(p => p.userId !== userId);

      if (isHost && remaining.length === 0) {
        // Nobody is left to hand it to, so the group goes with them.
        if (inviteIndex && typeof inviteIndex.remove === 'function') inviteIndex.remove(group);
        groups.delete(gid);
        summary.groupsDeleted.push(gid);
        summary.removedGroups.push(group);
        continue;
      }

      // Tell whoever is still connected, before the group changes under them.
      summary.notifySockets.push(
        ...remaining.filter(p => p.connected !== false).map(p => p.id)
      );

      if (isHost) {
        // Longest-standing remaining member. `players` is append-ordered, so
        // position is join order — the same basis host election uses.
        const heir = remaining[0];
        group.host = heir.userId;
        group.players = remaining.map(p => ({ ...p, isHost: p.userId === heir.userId }));
        summary.groupsRehosted.push({ groupId: gid, newHost: heir.userId });
      } else {
        group.players = remaining;
        summary.groupsLeft.push(gid);
      }
      changed = true;
    }

    // Pending join requests and decline counts are theirs alone.
    if ((group.joinRequests || []).some(r => r.userId === userId)) {
      group.joinRequests = group.joinRequests.filter(r => r.userId !== userId);
      changed = true;
    }
    if (group.declineCounts && Object.prototype.hasOwnProperty.call(group.declineCounts, userId)) {
      delete group.declineCounts[userId];
      changed = true;
    }

    // Rule 1: shared rounds keep their shape and lose their owner.
    if (anonymiseTheme(group.currentTheme, userId, tomb)) changed = true;
    for (const past of group.history || []) {
      if (anonymiseTheme(past, userId, tomb)) changed = true;
    }

    // Host notices are deliberately left alone. They are {id, kind, message,
    // createdAt} — free text with no user id on them — so there is nothing to
    // match a player against. A message can name someone ("X asked to join"),
    // but they are the host's own operational record of their group, and
    // pattern-matching a username out of prose would be guesswork that fails
    // quietly. An earlier version filtered on `n.userId`, which no notice has,
    // so it silently did nothing while reading as though it did.

    if (changed && !summary.groupsDeleted.includes(gid)) {
      summary.groupsAnonymised.push(gid);
      groups.set(gid, group);
    }
  }

  // --- topics -------------------------------------------------------------
  // Including public ones: "public" means offered to groupmates, not donated
  // to the app, so nobody else has a claim on the text.
  for (const topic of Array.from(topics.values())) {
    if (topic.creatorId === userId) {
      topics.delete(topic.id);
      summary.topicsDeleted += 1;
    }
  }

  // --- notifications, profile --------------------------------------------
  if (notifications.get(userId)) {
    notifications.delete(userId);
    summary.notificationsDeleted = true;
  }
  if (users.get(userId)) {
    users.delete(userId);
    summary.profileDeleted = true;
  }

  // De-duplicate: one socket can be in several of this user's groups.
  summary.notifySockets = Array.from(new Set(summary.notifySockets));
  return summary;
}

module.exports = { deleteAccount, DELETED_NAME, tombstoneId };
