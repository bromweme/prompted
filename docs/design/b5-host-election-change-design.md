# B5 Host Election — Vote on a New Host When the Host Abandons

Design notebook: [`.design/b5-host-election/notebook.md`](../../.design/b5-host-election/notebook.md)

## Executive Summary

A group whose host stops returning is permanently stuck. `group.host` is written exactly once, at
creation (`server/server.js:734`); `leave_group` refuses the host (`1041`); `delete_group` is
host-only (`1072`); and the disconnect handler only flips a transient `connected` boolean
(`1405-1420`) with no timestamp and no cleanup. So an abandoned host stays a permanent member
(`connected:false`, `isHost:true`), and the group is undeletable and unmanageable forever.

The proposed change adds the missing escape: a durable per-player **last-seen** timestamp, and a
**host election**. When the host has been gone more than a month, remaining current members may
either leave the group or vote for a new host; a majority of current members selects the new sole
host (`group.host` is reassigned). This is the first feature anywhere in the app to change
`group.host`.

## Requested Outcome

A group whose host abandons it must be recoverable by the members, not stranded.

| Scenario | Today | Proposed |
|---|---|---|
| Host gone more than a month | Group stuck, undeletable, unmanageable | Members may leave or vote on a new host |
| Majority of current members pick a successor | No mechanism | New host becomes the sole host |
| The old host returns | Old host still owns it (if still host) | Election either completed already (new host) or is cancelled if the old host returns before it resolves |

## Relevant Current Behavior

- **`group.host` is single-writer.** It is set to the creating `user.id` at `server/server.js:734`
  and never written again. All host-authorization gates (start_group `1104`, start_round `1149`,
  update_group `984`, delete_group `1072`, reassign_judge `947`, close_submissions `913`,
  dismiss_notices `892`) compare `group.host === userId`.
- **`player.isHost` is stored but redundant.** The client recomputes hostship: `mapPlayers`
  (`GroupView.jsx:16-25`) and Dashboard (`197`) derive `isHost` from `userId === group.host`. So
  changing `group.host` alone will re-derive every member's host badge — no client isHost storage
  update is strictly required (though coherency is cleaner if synced).
- **Presence is transient and untracked.** `connected` is set true on connect/reconnect
  (`join_group` `791`, `get_group` `845`) and flipped false on disconnect (`1414`). There is **no
  durable last-seen timestamp**; `connected` cannot answer "gone more than a month".
- **Identity is auth-bound.** Every handler uses `socket.data.userId` (auth middleware, `486`);
  an election must key votes and the abandoning-host determination by this, never a payload id.
- **Members list already renders everyone**, including disconnected players, with a Host badge
  (`GroupView.jsx:1185-1193`). Today the only roster actions are Leave (member, `1691-1711`) and
  Delete (host). There is no kick/remove affordance.

## Affected Surface

| Area | Change |
|---|---|
| `server/server.js` — player model | Add a durable `lastSeenAt` timestamp per player, stamped on connect and on an activity heartbeat (not only on disconnect, so a crashed client is still tracked). Persisted in the group blob so it survives restarts |
| `server/server.js` — host election | Determine "host gone > 1 month" from `lastSeenAt`; new events to open an election, cast a host vote, and resolve (majority) it; the election is the sanctioned override of the `leave_group` host guard (`1041`) and the single `group.host` writer |
| `server/server.js` — transfer | On majority, set `group.host = electedId`; update each player's `isHost` (or rely on the derived mapping); broadcast so all host gates re-point at the new host |
| `web-app/src/pages/GroupView.jsx`, `Dashboard.jsx` | An "election available" indicator when the host has been gone > 1 month; a leave-vs-vote choice; a ballot to nominate/vote the next host; surface it on the Participants roster |
| Contracts | New events (`host_election_open`, `host_vote`, token/state), a per-player `lastSeenAt` field, host-transfer broadcast |
| Tests | Presence tracking, election trigger gate, majority boundary, host transfer, old-host-returns |

## Candidate Seams and Options

- **Presence measure.** A durable per-player `lastSeenAt` (durable, survives restart, stamped on
  connect + heartbeat) is the only credible basis for "> 1 month". The transient `connected`
  boolean is insufficient. Chosen.
- **Election mechanics.** Participant decided: members either leave or **vote**; **majority** picks
  the new sole host. This is a first-past-the-post single-winner ballot among current members
  (excluding the abandoned host). Nominations: either any member may stand / the ballot lists
  current members and voters pick one.
- **Trigger.** Only when the host is determined gone > 1 month (not available while the host is
  around or briefly disconnected). Any current member can then open the election; others may leave
  or vote.
- **Transfer seam.** Swap `group.host` on majority. All downstream host gates automatically re-point
  because they key off `group.host === userId`. The `leave_group` host-refusal (`1041`) is
  bypassed only by the election's sanctioned transfer, not by a host acting on their own.

## Proposed Delta

1. **Presence**: add `lastSeenAt` to each `group.players` entry; stamp on connect and on a low-cost
   heartbeat (the existing get_group/join_group already re-establish presence). Persist in the
   group blob so "gone > 1 month" survives restarts.
2. **Election trigger**: a server-side determination `isHostAbandoned(group)` =
   `group.host !== currentMembers.some(...)` and `Date.now() - host.lastSeenAt > 30 days`. When
   true, remaining current members are offered leave-or-vote.
3. **Ballot**: an elected member opens the election (allowed only while the host is determined
   gone); any current member may leave the group (existing leave_group for non-hosts now includes
   the once-blocked host, but the host is gone so they won't vote) or cast one vote for a current
   member (auth-bound via `socket.data.userId`). A player cannot vote for themselves.
4. **Resolution**: when a candidate reaches a majority (> 50%) of current (non-abandoned-host)
   members, transfer `group.host = candidate`; set each player's `isHost`; broadcast the change;
   close the election. The new host becomes the sole host and inherits all host-gated actions.
5. **Old-host-return**: if the original host reconnects before the election resolves, cancel the
   election (the host is back and owns the group). If resolved first, the old host is just a
   member (or may leave).

## Transition and Coexistence

This is a new capability layered on the permanent-host model. Rounds, scoring, and settings are
unaffected until an election actually transfers hostship. In-flight groups gain `lastSeenAt`
(default: treat missing as "present"/recent on first read to avoid accidentally electing a new
host for existing groups — only freshly-tracked absence marks abandonment). No schema migration
beyond the additive per-player field; no contract removed.

## Decisions

| Decision | Choice | Confidence | Reason to reopen |
|---|---|---|---|
| Presence | Durable per-player `lastSeenAt` (connect + heartbeat), not transient `connected` | High | A durable stamp is the only basis for "> 1 month"; `connected` is instantaneous and un-tracked today |
| Abandonment threshold | Host gone > 1 month (30 days) from `lastSeenAt` | Medium — participant chosen | Exact interval ("what marks a month") is elided; a constant + configurable value is low-risk |
| Ballot | Any current member may open once host is determined gone; members vote for a current member; majority picks sole new host | High — participant decided | Ties/nominations not fully specified; a tie + re-vote or a default is a product-default question |
| Election integrity | Votes keyed by `socket.data.userId` only | High | Matches every existing auth check |
| Transfer | Swap `group.host`; downstream gates re-point automatically | High | Confirmed single-writer host + derived isHost |

## Research and Prototype Findings

No external research needed — this is an intra-app authorization/presence change. The trace
established the one material fact: there is no durable per-player presence today, so the "gone a
month" rule requires adding `lastSeenAt`. The transfer seam (single `group.host` writer, derived
`isHost`) makes the handoff low-surface.

## Remaining Design Questions

1. **"Gone more than a month" exactness.** Whether a month means no heartbeat for 30 calendar days.
2. **Tie/no-nomination.** What happens when two members tie or no member reaches a majority — a
   re-vote, or the election lapses.
3. **Who can open the election.** Any member once the host is gone, or a quorum. The participant
   said "give the other group members the option" — assume any current member can open, with a
   quorum as a possible guard.
4. **Old-host-returned edge.** Confirmed: if the host returns before resolution, cancel; if after,
   they're a member. The stash point is whether the election is resolvable while the old host is
   technically still `group.host` but offline.