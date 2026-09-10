# A1 Voting Deadline — Change Design

Design notebook: [`.design/a1-voting-deadline/notebook.md`](../../.design/a1-voting-deadline/notebook.md)
Source discovery: `docs/discovery/prompted-deep-discovery.md`, finding `f.deadline`.
Companion: `docs/design/c8-per-round-vote-budget-change-design.md` (C8 depends on this deadline
as its close trigger); `docs/design/round-stall-change-design.md` (the submission-phase pattern
this mirrors).

## Executive Summary

Voting can hang forever. A round reaches the voting phase when the Judge picks a topic or the
host/submission flow advances it, and then nothing on the server ever closes voting: there is no
voting deadline and no host escape (`close_submissions` operates only during submission). A round
in voting resolves only when every eligible voter has voted or the Judge names a winner — so one
absent player holds the result hostage.

The proposed change reuses the exact pattern the submission phase already shipped
(`advanceIfExpired`, server/server.js:198-238): a persisted absolute voting deadline evaluated
idempotently at the natural moments the round is handled, with the client's existing countdown
nudging the server when it reaches zero. When the voting deadline passes, the server completes
the round by running `calculateGroupResults` → `reveal`.

This fits because the submission deadline machinery, the `votingTime` setting, the client
countdown, and the `check_round_deadline` nudge all already exist. The only missing piece is
server behavior that sets and honors a voting deadline. Voting always runs to the deadline —
the participant decided there is **no early reveal** even when everyone votes early.

## Requested Outcome

A round's voting phase must always end.

| Scenario | Today | Proposed |
|---|---|---|
| Voting deadline passes | Round stays open forever (absent voter blocks reveal) | Round completes: winner calculated, revealed |
| Everyone votes before the deadline | Round reveals immediately | Voting waits for the deadline (no early reveal) |
| Voting opens | No deadline is set for it | A voting deadline is set from `votingTime` |

## Relevant Current Behavior

**The voting phase is the uncovered gap.** `advanceIfExpired` (server.js:198-238) opens by
guarding `theme.status !== 'submission'` (line 200) — it only ever ends the *submission* phase. It
has no voting branch. `close_submissions` (line 919) rejects unless `theme.status === 'submission'`,
so there is no host escape from voting either. A round in voting hangs until `calculateGroupResults`
is triggered by all-eligible-voted (line 1365) or the Judge's `czar_select_winner` (1373).

**`votingTime` is collected but inert.** The wizard collects it (`CreateGroup.jsx:52`, default 24h),
it is displayed in the Rules editor (`GroupView.jsx:1483`) and Overview (`1625`), and defaulted in
`Dashboard.jsx:98` / `GroupView.jsx:47/189`. It appears **zero times** in `server/server.js` — the
server neither reads it nor sets a voting deadline.

**The deadline is a persisted absolute instant.** `select_topic` sets `theme.deadline = now +
submissionTime` (server.js:635); `advanceIfExpired` reads it and re-arms (232). The client
countdown reads `theme.deadline` (`GroupView.jsx:128`) regardless of phase and nudges the server
with `check_round_deadline` when it hits zero (130, 138-141). Because it keys off `theme.deadline`
generically, **if the server sets a fresh voting deadline, the existing countdown and nudge
automatically apply to voting with no client change.**

**There is no scheduler.** A search for `setTimeout`/`setInterval` in server.js returns none (the
evaluation-on-read design). This is a deliberate, documented posture.

## Affected Surface

| Area | Change |
|---|---|
| `server/server.js` — `advanceIfExpired` | Add a `voting` branch that sets the phase to `reveal` via `calculateGroupResults` at deadline expiry |
| Voting entry points (`server.js:212`, `930`, `1275`) | Set `theme.deadline = now + votingTime hours` when voting opens |
| Settings validation | Read + validate `votingTime` (1-168h) in create/update, mirroring `submissionTime` |
| `web-app/src/pages/GroupView.jsx` | No logic change — the existing countdown + nudge key off `theme.deadline`; confirm the reveal renders (already does at status `reveal`) |
| e2e — `round-deadline.spec.js`, `round-phases.spec.js` | Add a voting-expiry test; remove/leave the early-reveal assumptions that C8 changes |

**Out of scope here:** the scoring/winner logic itself (unchanged); the multi-vote budget model
(C8, separate); the submission-phase deadline (already shipped).

## Options and Candidate Seams

- **Seam A — extend the single `advanceIfExpired`.** Its guard becomes
  `status === 'submission' || status === 'voting'`. The voting branch runs
  `calculateGroupResults` on expiry. Reuses all existing callsites (~805 get, ~852 join, ~878
  nudge, ~1280 start) and the existing client nudge. **Chosen** — least new surface, mirrors the
  shipped pattern exactly.
- **Seam B — a sibling `advanceVotingIfExpired`.** Cleaner separation of phase concerns but
  duplicates the callsite wiring and the nudge handling. Rejected unless A muddles responsibilities.
- **Seam C — a voting timer (setTimeout).** Rejected on the same grounds the submission design
  rejected timers: no restart survival, no existing scheduler, and the deadline already persists.

## Proposed Delta

1. **When voting opens** (all three entry points: `advanceIfExpired`'s non-zero branch at 212,
   `close_submissions` at 930, the all-submitted auto-advance at 1275), set a fresh voting
   deadline before leaving the submission phase:
   `theme.deadline = new Date(Date.now() + (group.settings.votingTime || 24) * 3600000).toISOString()`.
   This replaces the stale submission deadline so the countdown counts the voting window.
2. **In `advanceIfExpired`**, after the submission branch, add: if `status === 'voting'` and the
   deadline has passed, call `calculateGroupResults(group)` (which sets `status='reveal'`, tallies
   the winner, pushes history, persists, broadcasts) and return true — so the existing callsites
   broadcast the reveal. Preserve idempotence: the function only acts on `voting` with a genuinely
   past deadline, and `calculateGroupResults` moves the phase out of `voting`.
3. **No early reveal**: remove the `votes.length >= eligibleVoters.length` immediate-reveal at
   `server.js:1365` (voting always runs to the deadline). This is shared with C8; do it once.
4. **Validate `votingTime`** to 1-168 hours in the create/update settings path (mirror the
   `submissionTime` validation), so a crafted value cannot close/reopen a round absurdly fast.

## Transition and Coexistence

Rounds already in voting when deployed are picked up at the next evaluate point, because the
deadline is a persisted absolute instant and the check is evaluation-on-read — no data migration,
no scheduler to start. A voting deadline simply begins to be honored from then on.

## Decisions

| Decision | Choice | Confidence | Reason to reopen |
|---|---|---|---|
| Seam | Extend the single `advanceIfExpired` with a voting branch | High | Mirrors the shipped submission pattern exactly |
| Voting deadline setting | Reuse the existing `votingTime` (currently inert) | High | Already collected, displayed, and defaulted; only the read is missing |
| No early reveal | Voting always runs to the deadline | High — participant decision | If a fixed voting window feels slow, revisit early-reveal in play |
| Completion on expiry | Run `calculateGroupResults` → reveal | High | It is the existing terminal step |
| `votingTime` validation | 1-168h, mirror `submissionTime` | High | Prevents absurd windows from crafted payloads |

## Research and Prototype Findings

No external research or prototype needed. This is a direct mirror of the already-implemented,
well-tested submission-deadline pattern (`round-stall-change-design.md`), reusing an existing
inert setting (`votingTime`) and the existing client countdown/nudge. The one platform fact from the
prior design (Node setTimeout cap ~24.9 days) is irrelevant here because this design, like its
predecessor, uses evaluation-on-read rather than a timer.

## Remaining Design Questions

1. **Voting deadline default vs. submitted `votingTime`.** The current default is 24h; confirm the
   wizard's `votingTime` continues to control it (it does, once read server-side).
2. **Interaction with C8's budget.** A1's deadline is C8's close trigger; the two should be
   delivered together so voting closes on the deadline and the budget applies until then.
3. **Host escape** during voting (e.g. "close voting now") is not required by this change; C8/A1
   close on the deadline. If a host wants to force a reveal earlier than the clock, that is an
   addition.