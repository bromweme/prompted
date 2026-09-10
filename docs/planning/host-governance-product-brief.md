# Prompted Host Governance — Host Abandonment Election — Product Brief

## Product Narrative

**Who is affected:** the host and members of a Prompted group. The host is permanent: `group.host`
is set once at group creation and never changes. `leave_group` refuses the host, `delete_group` is
host-only, and the disconnect handler only flips a transient `connected` flag with no timestamp and
no cleanup.

**Current problem:** a host who stops returning is irreversible. Because nothing marks "how long the
host has been gone," and the host can't leave and only the host can delete, a group whose host
abandons it is permanently stuck — undeletable, unmanageable, and only the host could rebuild it. The
abandoned host stays a member forever (`connected:false`, still `group.host`).

**Intended change:** give a group a safe escape when its host is gone. Add a durable per-player
**last-seen** timestamp. When the host has been gone more than a month, remaining members get the
option to **leave the group** or **vote for a new host**; a **majority** of current members selects
the new sole host, who immediately inherits the host's powers. This is the first feature anywhere in
the app to reassign `group.host`.

**Why it matters:** it removes the one truly unrecoverable failure in the product. Every other stuck
state (absent voter, absent Judge) is resolved by game timing; a vanished host was the sole
permanent dead end. The election restores member agency to a group whose owner simply stopped coming.

## Outcomes and Delivery Boundary

**Outcomes this initiative must create:**
- The server can determine when a host has been gone more than a month (durable presence tracking).
- When the host is gone > 1 month, remaining members may either leave the group or vote on a new
  host.
- A majority of current members selects the new sole host; hostship transfers and the new host gains
  all host-gated powers.
- The abandoned host (if they never return) is off the ballot; if they return before the election
  resolves, the election cancels and they stay host.

**Delivery boundary (what this is NOT):**
- Not a change to the ordinary host model while the host is around — a present host is never voted
  out, and transient disconnects never trigger an election.
- Not the game rules / round timing / scoring (those are covered by the separate Gameplay & Round
  Timing brief).
- Not a "kick/remove member" feature generally — only the host-election path is in scope.
- Not session-token revocation or broader security changes.

## Defining Scenarios

**A host never returns.** A host creates a group, plays once, and stops opening the app. Over a month
passes with no connect and no heartbeat. Current members open the group and the UI surfaces
"host hasn't been here in a while — leave or vote on a new host." A member opens the election, votes
for a successor; a majority picks them; the new host takes over and can run or delete the group.

**A host is briefly offline.** The host's internet drops mid-round for an hour, then they return.
Nothing happens — they resume as host. No election is offered because the absence is far under the
month threshold and the host is present.

**A host returns during an election.** Members start voting, then the original host reconnects. The
election cancels; the returning host keeps the group.

**A member votes for themselves.** The election ballot lets members vote for a current member, but a
player cannot vote for themselves (auth-bound, matching the rest of the system); the server refuses
the self-vote rather than trusting the client.

## Business and Process Requirements

- **Presence rule.** Each player has a durable `lastSeenAt` timestamp (persisted in the group blob,
  survives restart), stamped on connect and on activity. The host is "abandoned" when
  `Date.now() - host.lastSeenAt > 30 days`.
- **Election trigger.** Only while the host is determined abandoned (> 30 days). Any current member
  may open the election; others may leave (the existing `leave_group` for non-hosts) or cast one vote
  for a current member.
- **Majority rule.** A candidate wins by a majority (> 50%) of current (non-abandoned-host) members.
- **Transfer.** On majority, `group.host` is reassigned to the elected member, who becomes the sole
  host and inherits every host-gated action (start, update settings, delete, reassign judge, close
  submissions, dismiss notices).
- **Old-host return.** If the original host returns before the election resolves, cancel the
  election; if after, they are a member (or may leave).
- **No self-vote / auth.** Votes and identity are resolved from `socket.data.userId`, never a
  payload-supplied id; a member cannot vote for themselves.

## Technology Requirements

- **Presence data.** Add `lastSeenAt` to each `group.players` entry, stamped on connect and on a
  low-cost heartbeat (the existing `get_group`/`join_group` presence re-establishment). Persist in
  the group blob so "gone > a month" survives restarts. `connected` alone is insufficient (it is
  transient and un-tracked).
- **Election events.** New server events to open the election, cast a host vote, and resolve it.
  Votes keyed by `groupId` + `userId` (auth-bound). Election state (open, nominees, votes) is durable
  on the group.
- **Host transfer.** On majority, write `group.host = newId` and update per-player `isHost` (or rely
  on the derived `userId === group.host` mapping the client already uses). All downstream host gates
  re-point automatically because they compare `group.host === userId`.
- **Override of the host guard.** The `leave_group` host-refusal (`server/server.js:1041`) is the
  guard the election bypasses — but only via a majority election, never by the host acting alone.
  An abandoned host is not on the ballot (they can't self-restore except by returning in time).
- **Compatibility/data.** Additive per-player `lastSeenAt` and election state on the group; no
  migration. Existing groups initialize `lastSeenAt` as "present" on first read so no existing group
  is accidentally offered an election.
- **Client.** Surface an "election available" indicator on the Participants roster when the host is
  determined abandoned; a leave-vs-vote choice; a ballot to nominate/vote the next host; reflect the
  new host's badge in `mapPlayers`/Dashboard after transfer.
- **Tests.** Presence tracking, election trigger gate, majority boundary, host transfer, old-host-
  returns-cancellation, self-vote refusal.

## People and Operating Requirements

- **Host:** owns the group while present; is never voted out while active. Host actions stay
  host-authorized. A host who abandons the group longer than a month loses it via election.
- **Members:** gain a recovery path (leave or elect a new host) only when the host is determined
  abandoned — not while the host is around.
- **Decision rights:** the group's current members (excluding the abandoned host) decide the new host
  by majority. The elected host inherits all host powers.
- **Operational ownership:** a stuck host-owned group becomes recoverable by members without support
  intervention. Escalation beyond the month threshold is self-service via election.

## Success and Readiness

**Observable success:**
- A group whose host has been gone > 30 days offers members a leave-or-vote election.
- A majority election transfers hostship; the new host can run and delete the group.
- A briefly-offline host is untouched; a returning host cancels an in-flight election.
- The full chromium e2e suite stays green (with the new presence / election tests).

**Readiness: `Ready for issue creation`.**
The narrative, the presence rule, the election trigger, the majority rule, and the transfer seam
(`group.host` single-writer → reassign; derived `isHost`) are settled. The boundary (only when
abandoned > 1 month; not a general kick feature) is explicit. No issue author would need to invent
product behavior, structure, or an owner.

**Non-blocking unknowns:**
- The exact "gone a month" clock (30 calendar days from `lastSeenAt` is the recommendation used; the
  precise definition of a connect/heartbeat is a constant to set, not a design change).
- What happens on a tie or no clear majority (proposed: the election stays open or lapses; a defined
  tie-break is a small product-default decision, not architecture-affecting).
- Whether nominations are open (any member may stand) or listed candidates only; the ballot UI is
  additive either way.

## Source Artifacts

- Discovery: `docs/discovery/prompted-deep-discovery.md` (host permanence finding `f.host`;
  background on why host role cannot transfer today).
- Requirements: `docs/design/product-requirements-elicitation.md` (decision B5, B6, B7).
- Design: `docs/design/b5-host-election-change-design.md`.
- Notebook: `.design/b5-host-election/`.
- Related (same game, not this initiative): `docs/design/gameplay-round-timing-product-brief.md`.