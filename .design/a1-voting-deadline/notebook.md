# A1 Voting Deadline — Design Notebook

## Current Position

Voting has no deadline. A round can hang in voting forever (finding `f.deadline`). The
submission phase already has `advanceIfExpired` (server.js:198-238) — an idempotent
evaluate-on-read function, no scheduler — that honors `theme.deadline` set from `submissionTime`.
The voting phase has no counterpart. A `votingTime` setting already exists (CreateGroup.jsx:52,
default 24h; displayed GroupView.jsx:1483; defaulted Dashboard.jsx:98 / GroupView.jsx:47) but is
inert server-side (0 reads in server.js).

Most recent: participant decisions — voting ends when the voting time expires; always wait for the
deadline (no early reveal). This also serves as C8's close trigger.

## Requested Change

When voting opens, set a voting deadline from the `votingTime` setting. At deadline expiry,
complete the round: run `calculateGroupResults` → `theme.status = 'reveal'`, broadcast the
result. Voting always runs to the deadline (no early reveal when all vote). Backs up the "no
deadlock" guarantee and closes finding `f.deadline`.

## Starting Sources

- `server/server.js` — `advanceIfExpired` (198-238), `calculateGroupResults` (393-480),
  transitions into voting (212, 930, 1275), evaluate points (805, 852, 878, 1280).
- `web-app/src/pages/CreateGroup.jsx:52` (votingTime), `GroupView.jsx:47/189/1483/1625`,
  `Dashboard.jsx:98`.
- `docs/design/round-stall-change-design.md` — the established submission-deadline pattern to mirror.
- `web-app/e2e/round-deadline.spec.js`, `round-phases.spec.js` — deadline + voting tests.
- `docs/design/c8-per-round-vote-budget-change-design.md` — depends on this deadline as close.

## Relevant Current Behavior

- `advanceIfExpired` (198): guards `status === 'submission' && deadline`; at expiry, if
  submissions exist → `status='voting'`; else re-arm (same Judge/topic, `currentRound` not
  incremented, host notice) up to `MAX_AUTO_REARMS`=3 then `rearmExhausted` stalls for host.
- Voting entry points: `close_submissions` (930), auto-advance-on-all-submitted (1275),
  `advanceIfExpired` non-zero branch (212). None sets a voting deadline.
- `calculateGroupResults` (393) computes the winner and sets `theme.status='reveal'`
  (456), pushes history, persists, broadcasts. It is the terminal step A1 should invoke at
  voting expiry.
- `votingTime` is collected/displayed but never read server-side.

## Affected Surface

- `server/server.js`: extend `advanceIfExpired` (or add a sibling) to handle `status === 'voting'`;
  set `theme.deadline` when voting opens; run `calculateGroupResults` at voting expiry. The
  existing evaluate points already call advanceIfExpired.
- `web-app/src/pages/GroupView.jsx`: countdown/nudge already exists for submission; ensure the
  nudge fires during voting too, and the reveal renders when the deadline closes voting.
- Settings: `votingTime` becomes read server-side (it already lands in group.settings via the
  un-whitelisted merge). Validate it (mirror submissionTime 1-168h).
- Tests: round-deadline.spec.js / round-phases.spec.js — voting-expiry tests; a counting-down
  voting phase.

## External Research

Not needed — this is a direct mirror of the established, implemented submission-deadline pattern
(round-stall-change-design.md). No platform question.

## Candidate Seams and Options

- **Seam A: extend the existing `advanceIfExpired`.** Since it already runs at the natural
  moments and returns "did anything change", widen its phase guard to also handle `voting`:
  at voting expiry, run `calculateGroupResults`. Reuse the existing callsites (805/852/878/1280)
  — no new scheduler, no new events for the server-triggered case. Chosen.
- **Seam B: a separate `advanceVotingIfExpired`.** Cleaner separation but duplicates the
  callsite wiring and the nudge. Not chosen unless A muddies responsibilities badly.
- Client nudge: reuse the existing zero-countdown nudge (round-stall design) so a quiet group
  advances. The nudge event already calls advanceIfExpired; if that function handles voting, the
  voting nudge is free.

## Proposed Delta

- When voting opens (all three entry points 212/930/1275), set `theme.deadline =
  Date.now() + votingTime hours` (mirror submissionTime line 232/635).
- In `advanceIfExpired`, add a voting branch: if `status === 'voting'` and deadline passed, call
  `calculateGroupResults(group)` (which sets status='reveal', tallies, pushes history) and return
  true. Reuse the existing evaluate points and the client nudge.
- Validate `votingTime` on create/update (1-168h), mirroring the submissionTime validation.
- Client renders the reveal once status flips to 'reveal' on broadcast (already handled).

## Decisions

- Closing trigger: the existing `advanceIfExpired` extended (high confidence — mirrors a shipped,
  well-tested pattern).
- No early reveal (participant): voting always runs to the deadline; the current
  `votes.length >= eligibleVoters.length` immediate-reveal (1365) is removed. This is C8's
  close too; they converge on one voting deadline.

## Transition States

Rounds already in voting at deploy: picked up at the next evaluate point because the deadline is
a persisted absolute instant (the pattern's existing rationale).

## Decisions

Record here as they are finalized.

## Research and Prototypes

None needed.

## Active Change Frontier

1. Confirm reusing one `advanceIfExpired` vs a sibling (decided: A).
2. Setting the voting deadline at all three voting-entry transitions (212/930/1275).
3. Validation bounds for `votingTime` (mirror submissionTime).

## Decision Map

- Status: not needed (ordinary compact frontier; direct mirror of a shipped pattern).

## Best Next Move

Write the change design report; delegate any residual trace (voting entry points + e2e) if needed.