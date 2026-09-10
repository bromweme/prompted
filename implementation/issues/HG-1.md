# HG-1 — Members can leave or elect a new host when the host has abandoned the group

- **Status:** Done (closure review passed, review-work)
- **Priority:** high
- **Depends on:** none
- **Source:** Product Brief `docs/planning/host-governance-product-brief.md`; design `docs/design/b5-host-election-change-design.md`.
- **Owner:** `server/server.js` (primary: presence + election events + host transfer), `web-app/src/pages/GroupView.jsx` / `Dashboard.jsx` (election UI), e2e. This is the first feature to reassign `group.host`.

## Useful outcome

A group whose host stops returning is no longer a permanent dead end. The server tracks how long each player has been gone. When the host has been absent more than a month, remaining members can either **leave the group** or **vote for a new host**; a majority of current members selects the new sole host, who immediately inherits all host powers (run, edit settings, delete, reassign Judge, close submissions, dismiss notices). A host who briefly disconnects is never affected; a host who returns in time cancels the election.

## What changes

**Product behavior:**
- The server determines when the host has been gone **more than a month** (durable presence tracking).
- While the host is determined abandoned, the group's UI offers members a **leave-or-vote** choice.
- A member opens the election and votes for a current member; a **majority** (> 50% of current, non-abandoned-host members) elects the new host.
- On election, hostship transfers: the elected member becomes the sole host with all host-gated powers. The abandoned host is off the ballot.
- If the original host returns before the election resolves, the election cancels and the host keeps the group; if after, the host is just a member.

**Technology changes:**
- `server/server.js`: add a durable per-player `lastSeenAt` timestamp, stamped on connect and on a low-cost heartbeat (the existing `get_group`/`join_group` presence re-establishment), persisted in the group blob so it survives restarts. `connected` alone is insufficient (it is transient and un-tracked today).
- Add election state and events on the group: open the election, cast a host vote, resolve by majority. Votes keyed by authenticated `socket.data.userId`, never a payload id; a member cannot vote for themselves.
- On majority, write `group.host = newId` (the single `group.host` writer, currently only set at create, server.js:734) and update per-player `isHost` (or rely on the derived `userId === group.host` mapping the client already uses). All host gates re-point automatically because they compare `group.host === userId`.
- The `leave_group` host-refusal (server.js:1041) is bypassed only by a majority election, never by the host acting alone.
- Client (`GroupView.jsx` Participants roster, `Dashboard.jsx`): surface "host abandoned — leave or vote on a new host"; a ballot to nominate/vote; reflect the new host badge after transfer.
- e2e: presence tracking, election trigger gate, majority boundary, host transfer, old-host-returns-cancellation, self-vote refusal.

## Requirements and delivery context

Product Brief commitments this issue must satisfy (see `docs/planning/host-governance-product-brief.md`):
- The server can determine when a host has been gone more than a month. (Outcome)
- Members may leave or vote on a new host when the host is gone; majority selects the new sole host; transfer. (Outcome)
- A present host is never voted out; a transient disconnect never triggers an election. (Boundary, decision B6)
- A returning host cancels an in-flight election. (Scenario)
- Host-gated powers transfer to the elected host. (People requirement)

Existing seams/contracts to preserve:
- All host gates key off `group.host === userId`; after transfer they re-point automatically.
- `group.host` is written only at create today; this issue adds the election as the (only) reassign path.
- Player membership / `group.players` stays the roster source; `lastSeenAt` is additive.
- Identity from `socket.data.userId` (auth-bound).

## Done when

- A group whose host has been gone > 30 days (per `lastSeenAt`) offers members a leave-or-vote election.
- A majority election transfers hostship; the elected member becomes the sole host and can run/delete the group.
- A briefly-offline host is untouched (no election) and resumes as host; a host who returns during an election cancels it.
- A member cannot vote for themselves; votes are tied to the authenticated identity.
- `web-app/e2e/host-leave.spec.js` and `leave-delete.spec.js` still pass, plus new presence/election tests in the full chromium suite.
- `cd web-app && npm run lint` shows no new errors (23 pre-existing warnings are the baseline).

## Depends on

None.