# REP-RT2-1 — Zero-point votes bypass the round budget and can manipulate the winner

- **Status:** Implemented (Wave 5) — closure review found a further blocking gap; awaiting repair `REP-RT2-2`
- **Priority:** high
- **Guarantee to restore:** A player must not be able to vote after their round budget is spent, and a vote must always cost budget. Specifically, "when the budget is spent … they can no longer vote this round" (Product Brief `gameplay-round-timing-product-brief.md`), and the per-round budget must be a real cap on voting strength rather than something free votes can multiply past. Casting a zero-cost vote that inflates a submission's `voteCount` and forces a `public_override` win is the abuse this repair closes.
- **Blocks:** `RT-2` (keeps it from reaching `Done`)
- **Depends on:** none

## Failed behavior

`cast_vote` (`server/server.js:1414-1523`) accepts `points: 0`. RT-2 replaced the old one-vote gate with a per-player point-budget gate, but a 0-point vote costs 0 budget and is never gated:

- Points validation (`:1460`): `points < 0 || points > maxPoints` rejects negatives and over-max but **allows 0**.
- Budget gate (`:1477`): `used + cost > budget` with `cost = 0` is `used + 0 > budget`, false while `used <= budget` — never trips.
- Share-the-wealth gate (`:1492`): `distinctAfter < 2 && used + cost >= budget` with `cost = 0` is `used + 0 >= budget` — only true once the budget is fully spent AND fewer than two distinct submissions are voted. Once a player has 2+ distinct submissions, 0-point votes pass unconditionally.

Because `calculateGroupResults` counts **every** vote into `voteCount` (`server/server.js:511`) and the public-override rule keys on `voteCount / totalVotes >= overrideThreshold` (`:520-525`), a player can cast an unbounded number of free 0-point votes on a chosen submission to ramp its vote share past the override threshold and force that submission to win even when its real point tally is low. This also contradicts the budget's purpose: after the budget is spent the player can keep voting.

## Trigger

A player with a non-empty budget casts their real votes (reaching the budget cap with 2+ distinct submissions), then keeps emitting `cast_vote { points: 0 }` on one submission. Each is accepted, inflates that submission's `voteCount`, and can drive `public_override`.

## Affected flow

1. RT-2's `cast_vote` accepts a 0-point vote (no budget cost, no count cap).
2. Repeated 0-point votes accumulate in `theme.votes`.
3. At the voting deadline, `calculateGroupResults` counts them all into `voteCount` and may trigger `public_override` for the pumped submission.
4. Observable failure: a player votes after their budget is spent, and a low-point submission wins via a pumped vote-count override.

Components that must change: `server/server.js` (`cast_vote` validation/gate). Fix direction: require positive points for upvotes (`points > 0`) and positive `downvoteCost`, so every cast spends budget. Confirm the change-reviewer's status: the change-reviewer did NOT find this (it stress-tested the single-sub full-budget dump, which is closed); the adversarial reviewer identified it. The fix must not break the Share-the-wealth rule or the existing self-vote rule.

## Repair requirements

- A cast with `points <= 0` (an upvote) must be rejected, so no vote is free and the budget remains a hard cap on how many votes / how much voting strength a player can exercise.
- A downvote must also always spend a positive `downvoteCost` (guard `downvoteCost` being set to 0 or negative at cast time; the existing `(downvoteCost || 1)` already coerces 0→1, but make the enforcement explicit and testable).
- The existing Share-the-wealth, self-vote, and `allowDownvotes` rules must be unchanged in effect.
- Preserve RT-1's no-early-reveal (voting closes on the deadline).

## Done when

- A crafted zero-point (or negative) upvote is rejected server-side, and a player cannot vote after their budget is spent.
- A focused regression (raw-socket e2e following `vote-budget.spec.js` style) covers: casting 0/negative points is rejected; after spending the budget, an additional 0-point vote is rejected; and a 0-point vote cannot inflate `voteCount` / trigger `public_override` for a low-point submission.
- `vote-budget.spec.js` and the full chromium suite still pass (84 tests before this repair).
- `cd web-app && npm run lint` shows no new errors (23 pre-existing warnings are the baseline).

## Depends on

None.
