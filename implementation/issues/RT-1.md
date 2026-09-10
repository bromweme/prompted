# RT-1 — Each round runs on two timed windows (submission and voting) that both close on their deadlines

- **Status:** Done (closure review passed, review-work; non-blocking follow-up `REP-RT1-1` filed)
- **Priority:** high
- **Depends on:** none
- **Source:** Product Brief `docs/planning/gameplay-round-timing-product-brief.md` (defining scenario "Voting reaches its deadline"); designs `docs/design/a1-voting-deadline-change-design.md` and `docs/design/a4-round-windows-change-design.md`.
- **Owner:** `server/server.js` (primary), `web-app/src/pages/GroupView.jsx`, `CreateGroup.jsx`, `Dashboard.jsx`, e2e. This slice is the shared "voting close" that the vote-budget issue (`RT-2`) builds on.

## Useful outcome

A round never hangs in the submission or voting phase. Each phase runs on a timed window: the host sets a submission length and a voting length (each a numeric value + unit: minutes/hours/days), the round honors a persisted deadline for each, and at each window's end the server advances the round — submission → voting, and voting → reveal (with the winner calculated). A player who doesn't act by a window's end misses that round; nobody is blocked by an absent player.

## What changes

**Product behavior:**
- The host sets a per-round **submission length** and **voting length** (numeric value + unit dropdown). Out-of-range values clamp to the nearest boundary (default ceiling 168 hours).
- The submission window closes on its deadline: with submissions, the round moves to voting; without, the existing `advanceIfExpired` behavior applies (re-arm the same round up to the cap, then notify the host).
- The voting window closes on its deadline: the server runs the winner calculation and reveals the result. Voting is **not** cut short when players vote early — it always runs to the deadline (no early reveal).
- The client countdown reflects whichever window is active; when the active window's deadline passes, the client nudges the server (existing `check_round_deadline`), and the server re-checks its own persisted clock before acting.

**Technology changes:**
- `server/server.js`: set a persisted voting deadline when voting opens; **widen `advanceIfExpired`** (server.js:198) so it also handles the `voting` phase (at voting deadline expiry, run `calculateGroupResults` → reveal). Remove the current "reveal as soon as everyone voted" immediate path (`votes.length >= eligibleVoters.length`, server.js:1365) — voting always closes on its deadline.
- Read and validate the **voting window length** server-side (it already round-trips via the settings merge, server.js:714/1009; apply the clamp). `votingTime` becomes active for the first time.
- Keep the no-scheduler, evaluate-on-read pattern: deadlines are persisted absolute instants evaluated at the natural moments (get/join/submit/start + the client nudge), with no `setTimeout`.
- Client (`GroupView.jsx`, `CreateGroup.jsx`, `Dashboard.jsx`): add the numeric + unit window controls for submission and voting; the countdown already renders whatever `theme.deadline` is, so it shows the active window.
- e2e: rework the `round-phases.spec.js` "cast once per player completes voting" loops to the timed-close model; add voting-window-expiry and submission-window-expiry tests.

## Requirements and delivery context

Product Brief commitments this issue must satisfy (see `docs/planning/gameplay-round-timing-product-brief.md`):
- Every submission window and every voting window ends on its deadline — a round always reaches a reveal. (Outcome)
- Host sets each window with a numeric value + unit; out-of-range clamps to bounds. (Business rule)
- Voting always runs to the deadline — no early reveal. (Decision A1)
- The "voting close" is the single shared seam that `RT-2` (vote budget) relies on; deliver it here so `RT-2` can layer on top. (Cross-issue)

Existing seams/contracts to preserve:
- `advanceIfExpired` (server.js:198-238) is the shipped evaluate-on-read deadline function; this issue extends its phase guard, does not replace the pattern.
- `calculateGroupResults` (server.js:393-480) is the existing terminal step; at voting expiry it runs unchanged.
- The client countdown (`GroupView.jsx:119-156`) and `check_round_deadline` nudge are existing; this issue only ensures they tick against the active (voting) window.
- Persisted data: `theme.deadline` already persists; no schema change. `votingTime` begins to act (behavior change covered by tests).

## Done when

- A round reaches the voting phase only while its submission window is open; when the submission window ends with submissions, voting opens.
- A round in voting reaches `reveal` (winner calculated and revealed) **when its voting window ends**, even if not everyone voted; and does **not** reveal early when players vote before the deadline.
- The host sets submission and voting lengths with a numeric value + unit; an out-of-range value clamps to the boundary.
- The client countdown shows the active window, and the server only acts after re-checking its own persisted deadline.
- `web-app/e2e/round-phases.spec.js` and `round-deadline.spec.js` pass (with the "cast once" loops reworked to the timed close), plus new voting-expiry and submission-expiry tests in the full chromium suite.
- `cd web-app && npm run lint` shows no new errors (23 pre-existing warnings are the baseline).
- The resulting voting-close contract is stable so `RT-2` (vote budget) can open a vote and apply the budget until that same close.

## Depends on

None.