# A2 Judge Skip-My-Turn — Change Design

Design notebook: [`.design/a2-judge-skip/notebook.md`](../../.design/a2-judge-skip/notebook.md)

## Executive Summary

A Judge who knows they are the Judge cannot decline. The only escape from the `topic_selection`
phase is the host manually reassigning the Judge to another player (`reassign_judge`,
`server/server.js:940-969`) — a host-only action. A Judge who is unavailable or does not want to
pick holds the round open.

The proposed change lets a Judge in `topic_selection` choose to **skip their turn**. Skipping
re-assigns the Judge role to **another member at random**, with a **fairness guarantee**: a member
who has already been the Judge is removed from the re-pick pool until every other eligible member
has served once, then the rotation resets. This no-repeat-until-all-served rotation tracks **across
rounds** (a group-level cycle), because with one Judge per round a per-round rotation would be moot.

## Requested Outcome

- As soon as a Judge learns they are the Judge (the moment `topic_selection` begins), they can
  choose "Skip my turn."
- Skipping randomly assigns the Judge to another member.
- Fairness: nobody repeats as Judge until everyone has had a turn this cycle; the cycle tracks
  across rounds and resets when complete.

## Relevant Current Behavior

- `beginRound` (`server/server.js:244-260`): picks a Judge — random among connected players, or
  `forcedCzarUserId` (host's manual pick). Sets `theme.czarId`.
- `select_topic` (`server.js:600-650`): only the current Judge can pick a topic; the phase must be
  `topic_selection`; on pick it moves to `submission` and sets `theme.deadline`.
- `reassign_judge` (`server.js:940-969`): host-only (`group.host === userId`), gated on
  `status === 'topic_selection'`, validates the target is in `group.players`, sets
  `theme.czarId = next.userId`. This is the only existing way to change the Judge.
- Client: the Judge sees the topic picker and an "you are the Judge" indicator (`isRoundLeader`
  from the group payloads, `GroupView.jsx`). The host has a "Pick Judge" modal; a manual pick
  re-runs the pick flow.
- e2e: `round-phases.spec.js` judges selection (~170-211); `round-deadline.spec.js` covers
  judge reassignment (~304-343) and the "Judge cannot be swapped once submissions open" rule
  (which keys on the `topic_selection` gate).

## Affected Surface

| Area | Change |
|---|---|
| `server/server.js` | New Judge-authorized event (e.g. `judge_skip`), gated on `userId === theme.czarId` and `status === 'topic_selection'`; re-assigns the Judge randomly among the pool of eligible non-Judge members, excluding anyone already Judged this cycle |
| Rotation bookkeeping | A group-level set of members who have served as Judge this cycle (persists across rounds; reset when all have served). Sits on the group (not `currentTheme`, which resets per round) |
| `web-app/src/pages/GroupView.jsx` | A "Skip my turn" control in the Judge's topic-picker; surface the rotation state (who has/hasn't served) so it's legible |
| e2e | A judge-skip test (including "already served" exclusion and cycle reset) |

## Candidate Seams and Options

- **Skip → random re-roll among eligible, no-repeat-until-all-served (chosen).** Matches the
  participant: "randomly assign the role to another person, however everybody go once before
  someone can do it again." The eligibility pool = other current members minus anyone already
  Judged this cycle.
- **Skip → host re-pick.** Rejected — puts the burden back on the host and contradicts the random
  rotation.
- **Skip → fixed round-robin next.** Rejected — the participant wants it random.

Rotation bookkeeping: a `judgedThisCycle` set on the group. A skipped Judge counts as having
served (they were chosen, even though they declined) so the rotation advances and they can't be
immediately re-picked. When `judgedThisCycle.size === eligibleMembers.size`, reset the set.

## Proposed Delta

1. Add a group-level `judgedThisCycle` set (`groupId -> [userIds]` or a field on the group blob).
   Members who served as Judge this cycle are recorded; reset when everyone eligible has served.
2. New `judge_skip` event: authorized only to `userId === theme.czarId` while `status ===
   'topic_selection'`. On skip, pick a new Judge at random from the other members **not** in
   `judgedThisCycle` (falling back to all other members when the set is full/would repeat),
   set `theme.czarId`, record the skipped Judge's `userId` in `judgedThisCycle`, persist, broadcast.
3. This is a Judge-authorized mirror of `reassign_judge` — the core difference is the caller
   (Judge vs. host) and the no-repeat pool.

## Transition and Coexistence

No long coexistence needed — this adds a Judge affordance and a group-level rotation set. Existing
groups without a `judgedThisCycle` initialize it empty (default: no one has served yet). The
existing host `reassign_judge` remains and is orthogonal (the host can still hand-select); the
rotation set is updated by it too so the bookkeeping stays coherent.

## Decisions

| Decision | Choice | Confidence | Reason to reopen |
|---|---|---|---|
| Action on skip | Random re-assign to another member | High — participant decided | — |
| Fairness | No-repeat until all served; tracked across rounds | High — participant decided | If the cycle should reset per round instead |
| Skip counts as served | Yes (rotates on) | Medium | Prevents the same member being repeatedly skipped-onto |
| Served-set storage | Group-level (persists across rounds) | High | A per-round `currentTheme` set would reset every round, defeating the cross-round guarantee |

## Research and Prototype Findings

No external research — this is an intra-app authorization/rotation change. No prototype required:
the change mirrors the existing `reassign_judge` handler and needs only a rotation bookkeeping set
and a new Judge-side control.

## Remaining Design Questions

1. **Pool floor.** With a 2-player group, only one other member exists; the "no-repeat" pool is
   trivial. Confirm the minimum group size at which rotation matters (the existing
   `MIN_PLAYERS_TO_START` = 2 gate already bounds this).
2. **Cycle scope.** "Across rounds" is decided; confirm whether a new Judge hand-selected by the
   host also advances the rotation (proposed: yes, for coherence).
3. **Repeated skipping — RESOLVED (participant).** When every player has skipped (the rotation
   pool is exhausted and they still decline), the role returns to the **first-assigned Judge**, who
   is **not given the pass option again** — they must play. Guard: once the full-cycle skip happens
   and it reverts to the original Judge, the skip affordance is disabled for that Judge.