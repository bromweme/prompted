# REP-RT2-2 — Fractional (non-integer) upvote points re-open the vote-count public-override pump

- **Status:** Implemented (Wave 6) — awaiting closure review
- **Priority:** high
- **Guarantee to restore:** The per-round vote budget must be a real cap on voting strength *and* on how many votes a player can cast. A player must not be able to cast an unbounded number of votes within a fixed budget, because unlimited votes let them inflate a submission's `voteCount` and force a `public_override` win.
- **Blocks:** `REP-RT2-1` / `RT-2` (keeps the vote-budget feature from reaching `Done`)
- **Depends on:** none

## Failed behavior

`cast_vote` (`server/server.js:1486`) validates upvote points as `typeof points === 'number' && Number.isFinite(points) && points > 0 && points <= maxPoints`, but never enforces integer points. The budget model is integer throughout (`voteBudget` is a rounded whole number, the client only offers integer point options), yet the server accepts arbitrary positive fractions like `0.1` or `1e-9`.

Because REP-RT2-1 closed only the `points <= 0` path, a crafted client can still spend its integer budget as an unbounded number of tiny votes:

- Budget 10, `maxJuryPoints` any, `points: 1e-9` ⇒ ~10^10 votes on one submission in one round.
- `calculateGroupResults` counts every vote into `voteCount` (server.js:511) and keys `public_override` on `voteCount / totalVotes >= overrideThreshold` (server.js:520-525).
- One player can drive a submission's vote share to ~100% and force that (possibly low-point) submission to win via `public_override`, regardless of real point totals.

This re-opens the exact "winner manipulation via vote count" class that DEF-1 (filed against RT-2) and REP-RT2-1 were meant to close. With integer points, votes-per-player ≤ budget (a genuine cap); without an integer check, the minimum positive cost is unboundedly small, so the cap on vote *count* collapses.

## Trigger

A crafted socket payload (the wire-level abuse model the budget e2e is built around): repeatedly emit `cast_vote { points: 0.1 }` (or smaller) on one submission. The legitimate UI never sends fractional points, so this is only reachable by a curmudgeonly/crafted client — exactly the threat the repair and its e2e defend.

## Affected flow

1. RT-2-1's `cast_vote` accepts a fractional positive upvote (no integer check).
2. Many fractional votes accumulate in `theme.votes` at trivial budget cost.
3. At the voting deadline, `calculateGroupResults` counts them all into `voteCount` and triggers `public_override` for the pumped submission.
4. Observable failure: a player casts far more votes than their budget "should" allow, and a low-point submission wins by an inflated vote-count override.

Components that must change: `server/server.js` (`cast_vote` validation). Fix direction: require `Number.isInteger(points) && points >= 1` for upvotes (the `points <= 0` check becomes `points < 1` / integer). The change-reviewer did not find this (it focused on the zero path); the adversarial reviewer identified it.

## Repair requirements

- An upvote with non-integer points (fractional) must be rejected server-side, so every cast spends at least 1 whole point and no player can exceed `budget` total votes in a round.
- Negative and zero points remain rejected (already covered by REP-RT2-1).
- The existing integer-cast paths (Share-the-wealth, self-vote, allowDownvotes, budget gate, RT-1 no-early-reveal) must be unchanged in effect.
- Preserve the REP-RT2-1 fix (positive points) and do not regress it.

## Done when

- A crafted `cast_vote { points: 0.5 }` (or any non-integer positive point) is rejected server-side.
- With an integer budget, no player can cast more than `budget` votes in a round, so none can drive a `public_override` purely by vote count.
- A focused regression (socket-level e2e in `vote-budget.spec.js` or a sibling spec) covers: a fractional-point upvote is rejected; and a fractional-point spam cannot inflate `voteCount`/trigger `public_override` for a low-point submission (reuse the `allowOverride` + low-threshold setup from the REP-RT2-1 test).
- The full chromium suite still passes (88 tests before this repair) and `cd web-app && npm run lint` stays at no new errors (23 pre-existing baseline).

## Depends on

None.
