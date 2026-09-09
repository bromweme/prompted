# C8 Per-Round Vote Budget — Design Notebook

## Current Position

Strongest current design (C8): Replace one-vote-per-round with TWO host-set point rules —
(1) a per-player TOTAL POINT BUDGET per round (host-set, e.g. 10 points; allocate across votes;
reset at next round start), and (2) the downvote cost (`downvoteCost`, already a setting). The
existing `allowDownvotes` on/off host rule stays. This supersedes the earlier "N votes" reading.

Most recent change: participant locked the model — "total point budget per round" (not a vote
count); reset at next round start; plus the existing downvoteCost and allowDownvotes host rules.

## Requested Change

- Host sets a total point budget each player can spend per round (a spend cap).
- Each vote spends a chosen point value on a submission (maxJuryPoints still caps any one vote).
- A downvote spends points from the round budget; its cost is `downvoteCost`.
- The budget resets at the START of the next round, so everyone can vote fully next round.
- `allowDownvotes` (allow/disallow) remains a host rule; decide whether to now enforce it
  server-side (it is client-only today — 0 matches in server.js; cast_vote never checks it).

## Starting Sources

- `server/server.js` — `cast_vote` handler (~1286-1370), `calculateGroupResults` (393-462),
  `advanceIfExpired` (198-238), scoring settings (czarPoints, downvoteCost, maxJuryPoints,
  allowOverride, overrideThreshold).
- `web-app/src/pages/GroupView.jsx` — voting UI (1030-1089), `handleCastVote` (545-570),
  `userVote` state (86-88, 1040-1043, 1013-1015), settings editor (1370-1440).
- `web-app/src/pages/CreateGroup.jsx` (348-379), `Dashboard.jsx` (92-94) — settings defaults.
- `web-app/e2e/round-phases.spec.js` — voting tests that encode the one-vote rule.
- `GAME_DESIGN.md`, `docs/discovery/*` — scoring contract and findings
  (`f.downvote`, `ev.settings.downvotes.clientonly`).
- `docs/design/product-requirements-elicitation.md` — decision C8.

## Relevant Current Behavior

Trace (trigger -> processing -> result):

1. Voting opens: `cast_vote` handler (1304-1307) rejects a second vote from the same player
   (`theme.votes.some(v => v.voterUserId === userId)` -> "You already voted this round").
2. Vote recorded: pushes `{ voterUserId, submissionId, points: isDownvote ? -downvoteCost :
   points, isDownvote, comment }` (1348-1354).
3. Own-submission rule: you cannot vote for your own submission (1309-1323).
4. Round completes when `theme.votes.length >= eligibleVoters.length` (1362-1369), where
   eligibleVoters = connected players with at least one other submission to vote for.
5. `calculateGroupResults` (393-462): tallies points per submission, resolves winner
   (public override -> czar selection -> popular vote), awards czarPoints to the winner's
   player, and separately docks `downvoteCost` from any downvoter's lifetime `score` (448-449).
6. Client: `userVote` state gates the whole vote UI (1040-1043); a player who has voted sees
   "You've voted — waiting for the rest of the group." Voting controls include a Points select
   (0..maxJuryPoints) and, when `allowDownvotes`, a Downvote button (1070-1074).

## Affected Surface

- Server: `cast_vote` (vote budget state, per-round reset), `calculateGroupResults` (whether
  the budget/`score` touch survives), `advanceIfExpired`/round transition (where reset happens),
  settings model + serialization.
- Client: `GroupView.jsx` voting panel (remaining-budget display, multi-vote interaction),
  `CreateGroup.jsx`/`Dashboard.jsx` settings defaults/editor, the `userVote` gating.
- Contracts: vote event payload, `group_details`/`group_updated` payload (does the client learn
  its remaining budget?), settings keys (add e.g. `votesPerRound`?), migration of existing
  settings/scores.
- Tests: `round-phases.spec.js` one-vote assertions; `round-deadline.spec.js`.
- Qualities: scoring fairness, deadlock protection, authorization (downvote gating).
- Owner: whole repo (server.js + web-app frontend + e2e).

## External Research

Findings from research agent (web_fetch against authoritative URLs; web_search was down):

1. This design is **cumulative / dot voting** with a host-set budget — an established, low-risk
   mechanic. Partial spending and plumping (all points on one option) are both allowed.
   Sources: Wikipedia "Cumulative voting", "Voting at the Eurovision Song Contest".
2. Budget sizing convention: number of entries a player can meaningfully favor (3-5), or a
   host-set arbitrary integer (Eurovision precedent: fixed 12,10,8..1 schedule; 1964-66
   "distribute 9 points"; viewer caps 20/show -> 10/show).
3. Downvotes should **share the same round budget** and carry an **asymmetric cost** (Stack
   Overflow shares one daily pool between up/down and taxes answer-downvotes). This matches the
   participant's "downvote spends from the round budget" + existing `downvoteCost`.
4. Known behaviors to design around: **plumping** (dump all on one) and **vote-splitting**
   (spreading can deny a favored entry). Product call, not a theorem — the participant decided
   concentration is a host-configurable rule.
5. Reset semantics: grant fresh budget at round start, unspent lapses silently, no banking.
   Matches participant's "reset at next round start".

Sources: https://en.wikipedia.org/wiki/Cumulative_voting ,
https://en.wikipedia.org/wiki/Voting_at_the_Eurovision_Song_Contest ,
https://en.wikipedia.org/wiki/Score_voting ,
https://stackoverflow.com/help/privileges/vote-down ,
https://en.wikipedia.org/wiki/Disapproval_voting

## Candidate Seams and Options

Three traces complete (server, client+tests, research). The design options:

**Seam A — Server-side budget gate + per-round used-points counter.**
Replace the one-vote gate (`server.js:1304` `theme.votes.some(v => v.voterUserId === userId)`) with a
per-player "points used this round" check against a host-set budget. Track used points either
(a) as a counter on `currentTheme` (e.g. `theme.voteBudgetUsed[userId]`) — auto-resets because
`beginRound` replaces `currentTheme` wholesale (server.js:260) — or (b) derive by summing
`theme.votes` per voter each time (no new field, but O(n) per cast). Option (a) is simpler and
matches the reset semantics. The gate then becomes: reject if used points + new vote points would
exceed the budget; enforce `allowDownvotes` here too (currently client-only).

**Seam B — New completion predicate.**
The current `theme.votes.length >= eligibleVoters.length` (server.js:1365) equates one vote with
one voter and breaks under a budget. Candidates:
- B1: round completes when every eligible voter has spent their full budget OR has no remaining
  budget to spend. Most faithful to "use your budget".
- B2: round completes when every eligible voter has cast at least one vote (keep a floor so no
  deadlock), with budget spend available until reveal.
- B3: host can close voting early (uses the existing `close_submissions`-style escape) but voting
  otherwise has no automatic completion except the deadline override.
Decision: participant-facing; likely B2 (floor) + a deadline escape (from A1) is the safest so a
round can never deadlock on someone with budget left going idle.

**Seam C — New host settings (persistence).**
Add `votesPerRound`-equivalent (the per-round point budget) to the Jury settings: `CreateGroup.jsx`
Jury section (~346-414) and `GroupView.jsx` Rules editor (~1374-1437), added to the normalize
defaults (GroupView.jsx:41-43, 177-199) and Dashboard transform (87-104). Server round-trip needs
no whitelist (spread at server.js:714/1009), only a server read+clamp in create/update validation.
`downvoteCost` already exists (server.js:449/1351).

**Seam D — Client budget model.**
Replace the boolean `userVote` (GroupView.jsx:88) with a "remaining points" value. The client
needs a server-delivered field (e.g. `yourRemainingVotePoints`, or server sends the player's used
points) in `group_updated`/`group_details`/`group_joined`; the local `userVote` optimistic flag is
insufficient because it cannot distinguish "budget exhausted" from "mid-budget". The `1040` gate
and `1015` disabling must change to allow repeated selection while budget remains. The per-round
reset effect (158-165) resets the remaining to the budget.

**Seam E — Downvote economics.**
A downvote spends `downvoteCost` from the round budget (matches participant: "downvote spends from
the round's budget"). Decided: downvotes share the budget and carry asymmetric cost (research:
Stack Overflow). The score docking at server.js:448-449 (lifetime `score -= downvoteCost`,
finding `f.downvote`) is separate and may or may not survive — needs a decision.

[see Decisions below for the resolved/outstanding choices]

## Proposed Delta

Current behavior -> proposed behavior:

- Server `cast_vote` gate (server.js:1304): one-vote scan -> per-player used-points check against a
  host-set budget; reject when this vote would exceed the remaining budget; reject a downvote when
  `allowDownvotes` is false (new server-side enforcement).
- `calculateGroupResults` (server.js:393-480): unchanged winner-tally simplifies — downvoter lifetime
  score docking (448-449) removed; downvoting impacts only the submission tally and the voter's
  budget.
- Completion (server.js:1365): the `votes.length >= eligibleVoters.length` immediate-reveal path is
  REMOVED. Voting closes on its deadline (ties to A1). A player's budget spend continues until the
  close; no deadlock because time (not a completion condition) ends voting.
- Per-round budget state: new `theme.voteBudgetUsed` map (or a per-player counter) auto-resets when
  `beginRound` (server.js:260) replaces currentTheme.
- New host settings: the per-round budget amount + a concentration allowed/disallowed toggle. Both
  round-trip freely (spread at 714/1009); add clamps in create/update validation.
- Client (`GroupView.jsx`): replace boolean `userVote` (88) with a remaining-points value sourced
  from the server (a new field in group_* payloads); rework the 1040 gate and 1015 disabling so a
  player can keep voting while budget remains; reset to full budget at round start. Add the settings
  inputs to CreateGroup.jsx and GroupView.jsx Rules editor.
- e2e: rework round-phases.spec.js "cast once to complete" loops (404-408/438-441/487-488) to the
  timed-close model; add a downvote-budget and downvote-enforcement test.

Contracts added: a remaining-budget field in the group payload; a host-set budget + concentration
setting. No serialization change required (settings spread freely).

## Transition States

Old one-vote model and new budget model do not need long coexistence — this is a schema-compatible
setting change (new settings keys, per-round counter). In-flight rounds: a round already in voting
when a host changes the budget should either fix the new budget on that round's `theme` or apply it
only from the next round. Recommend: budget is read per-cast from current settings, so a mid-round
change affects the rest of that round; acceptable and simplest. Downvote-score removal is
immediate (no migration needed; scores simply stop docking).

## Remaining Design Questions

1. The voting deadline mechanism itself (A1, separate design pass) — C8 depends on it being the
   close trigger; C8 does not design the deadline clock.
2. Budget + concentration defaults (suggest a default budget ~ maxJuryPoints-based and concentration
   on/off default) — product-default choice.
3. Whether a player's own submission can be voted by others under concentration (existing own-vote
   rule endures regardless).

## Domain Model

Terms in play: group.host (permanent owner); Judge (rotating per-round, formerly "round
leader"); vote (one cast); budget (new: per-player-per-round vote allowance). Invariant to
preserve: a player cannot vote for their own submission; a player cannot exceed their per-round
budget; everyone who wants to may vote their full budget each round (resets). Potential
conceptual tension: how "vote" and "budget" relate to the existing `score`/`downvoteCost`
points vocabulary — the current downvote double-charge is a known finding (`f.downvote`).

## Transition States

Pending (old one-vote model + new budget model coexistence).

## Decisions

Participant decisions (locked):
- **Core model:** total point budget per player per round (host-set); each vote spends points on a
  submission (maxJuryPoints caps any one vote); downvoting spends budget at `downvoteCost`. Reset
  at next round start.
- **Completion:** the round ends WHEN THE VOTING TIME EXPIRES (deadline). There is NO
  immediate-reveal-when-everyone-voted fast path. Voting is a fixed timed phase.
- **Early reveal:** voting always runs to the deadline; even if everyone votes early, wait for the
  clock. (This removes the current server.js:1365 immediate-reveal path.)
- **Downvote score:** a downvote ONLY spends from the round budget; the separate lifetime score
  docking (server.js:448-449, finding f.downvote) is REMOVED. One cost, not two.
- **Concentration:** whether a player may spend the whole budget on one submission is decided by a
  HOST RULE (a setting), not a fixed model choice.
- **Downvote enforcement:** because C8 makes downvotes spend budget, server-enforce `allowDownvotes`
  (currently client-only) — reject a crafted downvote when the group forbids downvotes.

Design-settled from evidence:
- Used-points tracking: a per-player `usedPoints` counter on `currentTheme` (auto-resets via
  beginRound replacement at server.js:260), simpler than deriving from theme.votes each cast.
- Persistence: new host settings round-trip without a server whitelist (spread at 714/1009); add
  the setting key + clamp to create/update validation (~715/722/996/1006).
- Downvotes share the round budget and carry asymmetric cost (research: Stack Overflow shared
  pool precedent).

Confidence: high on core model + completion (participant-decided). Medium on the "always wait for
deadline + no early reveal" (removes an existing fast path — the e2e suite will need rework) and on
the new downvote enforcement (a behavior change for crafted sockets).

Reason to reopen: if a fixed voting phase feels slow in play, revisit early-reveal; if the downvote
budget cost feels too weak/strong, the budget/downvoteCost sizing is a setting, not structural.

## Research and Prototypes

Pending.

## Active Change Frontier

1. Client + test surface: exactly which UI/tests break under the budget model (trace pending).
2. How to track per-player used points within a round: a per-player `usedPoints` counter on
   `currentTheme` (auto-resets each round) vs. deriving spent totals from `theme.votes`. The
   counter is simpler and avoids summing; the server trace confirms no counter exists today.
3. New completion predicate: the current `votes.length >= eligibleVoters.length` (1 vote =
   1 voter) breaks under a point budget. Candidates: complete when every eligible voter has
   spent their full budget (or has zero remaining), OR complete when all have cast at least one
   vote (keep the "deadlock guard" from the two-player case). Must preserve the premise that a
   player whose only legal submission is their own cannot block the round.
4. Whether to server-enforce `allowDownvotes` (client-only today, 0 matches in server.js).
   Because C8 makes downvotes spend budget points, enforcement becomes more relevant — decide
   whether a crafted `isDownvote:true` should now be rejected when the group forbids downvotes.
5. New host settings: the point budget amount (e.g. `votesPerRound`/`voteBudget`) validated in
   the host write path (~715/~996/~1009). `downvoteCost` already exists.
6. UI: what remaining-budget the client needs to render (a served "your remaining points"), and
   how it rides the existing `group_updated`/`group_details` payload.

## Decision Map

- Status: complete (all consequential frontier questions resolved with participant decisions).
- Path: none.
- Destination: a coherent proposed delta for a host-set per-round total-point budget with a
  time-based voting close.
- Return condition: report is publishable.

## Best Next Move

Write the change design report (`docs/design/c8-per-round-vote-budget-change-design.md`), then
synthesize. Dependencies for later passes: A1 (voting deadline) is the close trigger this design
depends on; that is a separate change-design or fold-in.

Notebook state is current and compact; a future session can resume from the Proposed Delta.