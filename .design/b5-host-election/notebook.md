# B5 Host Election — Vote on a New Host When the Host Abandons

## Design Notebook

## Current Position

The host is permanent. `leave_group` refuses the host (REP-GL1-1, server.js:1041). There is no
path for members to replace a vanished host. A group whose host stops returning is unmanageable
and undeletable by anyone else.

Most recent: participant decision — when the host has been gone more than a month, remaining
members get the option to (a) leave the group, or (b) vote on a new host. A majority vote among
current members selects the new host, who becomes the sole host. Only when the host is inactive
for the long period.

## Requested Change

Track a host's inactivity (a durable "gone" measure). When the host has been absent > 1 month,
members may initiate a host-election: anyone still in the group may either leave or vote for a
successor; a majority selects the new sole host.

## Starting Sources

- `server/server.js` — the host guard `leave_group` (1041), `delete_group` host-only (1072),
  `disconnect` handler (1405-1416), connection tracking (741/791/845), creation/join.
- `web-app/src/pages/GroupView.jsx`, `Dashboard.jsx` — host badge, members list, admin controls.
- `web-app/e2e/host-leave.spec.js`, `leave-delete.spec.js` — host-leave / delete / membership.
- `docs/design/c8-per-round-vote-budget-change-design.md` — a reusable "vote with a budget" /
  majority-vote idea for the host election ballot.

## Relevant Current Behavior

- Player model: `group.players[]` with `{ id, userId, username, avatar, connected, isHost? }`.
  `connected` is a transient socket boolean flipped by disconnect (1405-1416). There is **no
  persisted last-seen/activity timestamp** — essential for a "gone > 1 month" rule.
- `leave_group` refuses the host (1041-1044); a member may leave (1046-1056).
- `delete_group` is host-only (1072).
- Member leave + rejoin is supported (tests). No host transfer exists.

## Affected Surface

- Player/host model: add a persisted `lastSeen` (or `lastActiveAt`) timestamp per player, updated
  on connect and on activity, stored in the group blob (durable across restarts). This is the
  foundation the "> 1 month" rule needs; `connected` alone is not durable.
- Server: a host-inactivity determination ("is the host gone > 1 month"); an initiate-election
  event; a cast-host-vote event; majority tally; transfer of `group.host` on majority. Reconcile
  with the `leave_group` host guard (1041) — the election is the sanctioned override.
- Client: an "election available" indicator when the host is gone > 1 month; a leave-vs-vote
  choice; a ballot UI for nominating/voting the next host; a members list.
- Contracts: new events (initiate/ cast host vote), a `lastSeen` field, host-transfer broadcast.
- Tests: presence tracking, election flow, majority boundary, host transfer.

## External Research

Not needed (intra-app authorization/presence change). No platform question.

## Candidate Seams and Options
- Presence measure: persisted `lastSeen` timestamp per player (durable) vs. some session store.
  The participant said "gone more than a month"; a durable per-player lastSeen updated on connect
  is the natural fit.
- Election mechanics: single nomination round + majority vote (matching the participant's answer),
  vs. a ranked/first-past-the-post ballot. Majority of current members picks the sole host.
- Initiation: any current member can open an election once the host is determined gone; others
  then either leave or vote.
- Ties/abstention: define how "majority" counts (e.g. >50% of current non-host members), and
  what happens on a tie.

## Proposed Delta
TBD after a trace of the presence/connection model and the client members/admin UI.

## Decisions
TBD.

## Active Change Frontier
1. Durable last-seen timestamp: confirm the presence model can support a "gone > 1 month" check
   (trace).
2. Election trigger: does any member open it, or does the group need a quorum to even offer it?
3. Majority rule: > 50% of current members? What about a tie or no-candidates?
4. Interaction with the host `leave_group` guard (1041) — the election is the override path.
5. What happens to the election if the original host returns before it completes.

## Decision Map
- Status: not needed.

## Best Next Move
Delegate a trace of (a) the player `connected`/presence + disconnect/connect model and (b) the
client members/admin UI, to ground the presence measure and the election surface.