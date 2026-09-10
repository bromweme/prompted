# Prompted Gameplay & Round Timing — Product Brief

## Product Narrative

**Who is affected:** the players and hosts of Prompted, a music-league game where a group's Judge
picks a topic, players submit a song, and everyone votes on the best one. The problems this
initiative fixes are all about the round feeling stuck or unfair: voting can hang forever waiting
on an absent player, a Judge who won't pick a topic holds the round, and the scoring lets each
person vote only once with no real budget to express taste.

**Current problem:** a round's timing and scoring work against the players. Voting has no deadline,
so one absent voter blocks the reveal. A Judge who doesn't pick leaves the group stuck with only the
host able to reassign. Each player gets exactly one vote worth a fixed number of points, so a player
cannot reward a favorite and a lesser strong entry at different strengths, and a downvote still
double-penalizes (it docks the target and the voter's lifetime score).

**Intended change:** make every round rot to a clear finish and let scoring express real taste.
Voting and submission each get a timed window a host controls. A Judge can skip their turn — with a
fair rotation so nobody has to judge twice before everyone has judged once — and if the whole group
keeps skipping, the first Judge must play. Scoring becomes a per-round point budget: the host sets
how many points each player may spend per round (default 10), and a "Share the wealth" toggle
(default on) decides whether a player must spread those points or may concentrate them.

**Why it matters:** these changes turn "waiting and stuck" into "each round runs to a result" and
give scoring real depth, so the group's rounds feel fair, complete, and worth playing again.

## Outcomes and Delivery Boundary

**Outcomes this initiative must create:**
- Every submission window and every voting window ends on its deadline — a round always reaches a
  reveal.
- A Judge can pass their turn; the role rotates fairly across the group; nobody is forced to judge
  twice before everyone has judged once, and when everyone skips, the first Judge plays.
- Each player has a host-set per-round point budget (default 10) to spend across their votes.
- A "Share the wealth" toggle (default on) governs whether points must spread or may concentrate.
- A downvote spends from the player's round budget and no longer also docks a lifetime score.

**Delivery boundary (what this is NOT):**
- Not a change to the winner-resolution order (public override → Judge pick → popular vote).
- Not the host-abandonment / host-election story (that is a separate brief, B5).
- Not the inert settings cleanup (`totalRounds`, `maxPlayers`, `autoStart`, chat, preview, voter
  identity), which remain out of scope.
- Not a scheduler: timing continues to use the evaluate-on-read pattern, with no server-side
  `setTimeout` on a round.

## Defining Scenarios

**A player submits late.** Topic is chosen; the submission window opens with a deadline. A player
never submits; when the window closes, the round advances to voting with whatever arrived (existing
`advanceIfExpired` guarantees), so the round doesn't hang on the absent player.

**Voting reaches its deadline.** Voting opens with its own window. Some players don't vote. When the
voting window ends, the server completes the round: winner is calculated and revealed. Nobody is
blocked by a straggler, and voting is not cut short for players who voted early — every eligible
voter's budget applies until the window closes (no early reveal).

**A Judge wants to pass.** The Judge is told they are the Judge and sees the topic picker. They
choose "Skip my turn." The role moves to another member at random, excluding anyone already Judged
this cycle. If the whole group skips, the role returns to the first-assigned Judge, who is not
offered the pass again — they must pick a topic.

**A player spends their budget.** With a 10-point budget and "Share the wealth" on, a player gives a
favorite 6 points and a strong second 4 points, but cannot put all 10 on one song. With the toggle
off, they may spend the whole 10 on one favorite. When their budget is spent (or the voting window
closes), they can no longer vote this round, and next round their budget resets.

**A crafted downvote bypass.** A player sends a raw-socket downvote even though the group forbids
downvotes; the server rejects it, because `allowDownvotes` is now enforced server-side.

## Business and Process Requirements

- **Round must finish.** Both the submission window and the voting window close on their deadlines;
  a round never hangs in a phase waiting on an absent player.
- **Host sets the windows.** A host sets each round's submission length and voting length with a
  numeric value plus a unit (minutes/hours/days). Out-of-range values clamp to the nearest boundary
  (default ceiling 168 hours).
- **Host sets the budget.** The per-player per-round point budget is host-set (default 10),
  evaluated and enforced server-side.
- **"Share the wealth" rule.** Default on: a player must spread points across at least two
  submissions. Off: a player may concentrate the full budget on one.
- **Downvote cost.** A downvote spends `downvoteCost` from the voter's round budget. It no longer
  also docks a lifetime score. `allowDownvotes` is enforced server-side (reject a downvote when the
  group forbids it).
- **Judge rotation.** A Judge may skip in `topic_selection`. The replacement is chosen at random
  from members not already Judged this cycle; the cycle tracks across rounds and resets when all
  have served. If everyone skips, the first-assigned Judge must play (no pass offered).

## Technology Requirements

- **Voting close (shared seam, A1/A4/C8).** One voting-close mechanism: the voting window's deadline
  is a persisted absolute instant; `advanceIfExpired` (`server/server.js:198`) is widened so it also
  closes the voting phase (running `calculateGroupResults` → reveal). Reuses the existing
  evaluate-on-read callsites and the client `check_round_deadline` nudge. No scheduler.
- **`votingTime` becomes active.** Read server-side for the first time (it already round-trips via
  the settings merge, `server.js:714/1009`); validate/clamp it.
- **Per-round budget state.** Per-player budget-usage lives on `currentTheme` (auto-resets each round
  via `beginRound` replacing it, `server.js:260`). The `cast_vote` one-vote gate (1304) becomes a
  per-player used-points check against the budget; enforce "Share the wealth" (spread) and
  `allowDownvotes` there.
- **Remove immediate-reveal.** Delete the `votes.length >= eligibleVoters.length` early-reveal path
  (`server.js:1365`); voting ends only on its deadline.
- **Downvote scoring.** Remove the lifetime score dock in `calculateGroupResults` (`server.js:448-449`).
- **Judge rotation state.** A group-level "already judged this cycle" set (persists across rounds,
  resets when complete); a new Judge-authorized `judge_skip` event mirroring `reassign_judge` (940).
- **Settings.** New/active settings: voting window length, per-round budget (default 10), "Share the
  wealth" (default on). Clamp out-of-range values to boundaries. Settings round-trip via the existing
  un-whitelisted merge (no serializer change).
- **Compatibility/data.** Per-round budget on `currentTheme` (auto-reset) and a group-level rotation
  set; additive fields, no migration. `votingTime` begins to act (a behavior change covered by tests).
- **Client.** `GroupView.jsx` voting panel replaces the boolean `userVote` gate with a
  remaining-budget model (server-delivered field); a "Share the wealth" toggle and the budget/unit
  inputs in the Rules editor and `CreateGroup.jsx` Jury section; a Judge "Skip my turn" control in the
  topic picker; the countdown renders whichever window is active.
- **Tests.** `round-phases.spec.js` "cast-once-completes" loops rework to timed close; new tests for
  voting expiry, budget enforcement, "Share the wealth", downvote budget + server enforcement, and
  judge skip / rotation.

## People and Operating Requirements

- **Host:** owns the timing windows (submission + voting lengths), the per-round budget, the "Share
  the wealth" toggle, downvote settings. Host actions continue to be host-authorized
  (`group.host === userId`).
- **Judge:** can skip their turn while in `topic_selection`; the replacement is Judge-authorized,
  not host-only (a shift from today's host-only reassign).
- **Players:** receive a per-round budget that resets; can vote across submissions until the window
  closes or the budget is spent. A player still cannot vote for their own submission.
- **Downvote decisions** are host-controlled (`allowDownvotes`, `downvoteCost`); player-facing cost
  is one (the budget), not two.
- **Operational ownership:** unchanged — this is a multiplayer game surface with no admin/billing
  surface impacted. Escalation for "a round is stuck" is resolved by the timed windows (no manual
  unstick needed).

## Success and Readiness

**Observable success:**
- A round with an absent voter reaches a reveal when the voting window closes.
- A Judge can skip; the role rotates fairly; a full-skip reverts to a Judge who must play.
- A player can spend a multi-point budget across votes, can't exceed it, and resets next round.
- A downvote spends budget and does not double-penalize; a forged downvote is refused when
  disallowed.
- The full chromium e2e suite stays green (with the rework to the timed-close voting flow).

**Readiness: `Ready for issue creation`.**
The product narrative and delivery boundary agree with the source decisions. The defining scenarios
resolve cleanly. Architecture commitments (shared voting close, per-round budget, judge rotation,
setting clamps) are settled. Downvote-cost semantics are a deliberate one-cost decision. No issue
author would need to invent product behavior or an owner.

**Non-blocking unknowns** (do not change requirements or architecture):
- The exact copy under the "Share the wealth" checkbox (the rule and default are set; only the
  wording is open).
- The precise clamp ceiling for units (default 168h used) and whether the budget default (10) should
  also show a unit, pending the final numeric/unit UI.
- The exact full-cycle edge for judge rotation beyond "first Judge plays" is specified; the copy of
  the rotation indicator is a presentation detail.

## Source Artifacts

- Discovery: `docs/discovery/prompted-deep-discovery.md` (findings `f.deadline`, `f.settings`,
  `f.datele`/scoring notes; `f.downvote` as background on the double-penalty).
- Requirements: `docs/design/product-requirements-elicitation.md` (decisions A1, A2, A4, C8).
- Design:
  - `docs/design/a1-voting-deadline-change-design.md`
  - `docs/design/a2-judge-skip-change-design.md`
  - `docs/design/a4-round-windows-change-design.md`
  - `docs/design/c8-per-round-vote-budget-change-design.md`
- Notebooks: `.design/a1-voting-deadline/`, `.design/a2-judge-skip/`, `.design/a4-round-start-end-time/`,
  `.design/c8-per-round-vote-budget/`.