# RT-2 — Per-round vote budget with "Share the wealth" and a single downvote cost

- **Status:** In progress (Wave 4)
- **Priority:** high
- **Depends on:** [`RT-1`](RT-1.md) (the voting window close — the budget applies until that same close)
- **Source:** Product Brief `docs/planning/gameplay-round-timing-product-brief.md` (defining scenario "A player spends their budget"); design `docs/design/c8-per-round-vote-budget-change-design.md`.
- **Owner:** `server/server.js` (primary: `cast_vote`, `calculateGroupResults`), `web-app/src/pages/GroupView.jsx` (voting panel), `CreateGroup.jsx`, `Dashboard.jsx`, e2e.

## Useful outcome

A player's voting strength is now a real budget, not a single vote. The host sets how many points each player may spend per round (default **10**). A player spends points across votes on other players' submissions; a downvote spends from that same budget; the budget resets each round. A "**Share the wealth**" toggle (default on) decides whether a player must spread their points across at least two submissions or may concentrate the whole budget on one. A downvote costs only from the round budget — it no longer also docks a lifetime score. This layers on the voting window close (`RT-1`): the budget applies until that window ends.

## What changes

**Product behavior:**
- The host sets the per-round point budget (default 10) and the "Share the wealth" toggle (default on).
- Each player has that budget to spend per round: each vote spends a chosen point value on a submission (the per-vote max `maxJuryPoints` still caps any single vote). A player can cast multiple votes while their budget remains.
- "Share the wealth" (on, default) forces the player to spread points across at least two submissions; off allows concentrating the whole budget on one.
- The budget resets at the start of each round, so everyone can vote fully next round.
- A downvote spends `downvoteCost` from the round budget. It no longer also docks the voter's lifetime `score` (the old double-penalty is removed). `allowDownvotes` is now enforced **server-side** — a crafted downvote when the group forbids downvotes is rejected.
- When the budget is spent, or the voting window ends (`RT-1`), the player can no longer vote this round.

**Technology changes:**
- `server/server.js` `cast_vote` (1288-1370): replace the one-vote gate (`theme.votes.some(v => v.voterUserId === userId)`, line 1304) with a **per-player used-points check** against the host-set budget; reject a vote that would exceed the remaining budget; enforce "Share the wealth" (spread) and `allowDownvotes` server-side.
- Track per-player budget usage on `theme` (per-round, auto-resets via `beginRound` replacing `currentTheme`, server.js:260).
- `calculateGroupResults` (393-480): remove the lifetime downvoter score dock (448-449); scoring otherwise unchanged.
- Add the budget and "Share the wealth" settings (validate/clamp the budget; the toggle is boolean). Settings round-trip via the un-whitelisted merge (server.js:714/1009).
- Client (`GroupView.jsx` voting panel ~1040-1089, `handleCastVote` ~545-571): replace the single boolean `userVote` gate with a **remaining-budget** model served by the server; rework the "Spread the wealth"-aware vote UI; add the budget + toggle to the Rules editor and `CreateGroup.jsx`.
- Contracts: the client needs a remaining/used-budget field (not delivered today); add it to the group payload used by the voting UI.
- e2e: add budget-spend, "Share the wealth" (spread vs concentrate), downvote-budget-cost, and server-enforcement tests.

## Requirements and delivery context

Product Brief commitments this issue must satisfy (see `docs/planning/gameplay-round-timing-product-brief.md`):
- Each player has a host-set per-round point budget (default 10) to spend across votes. (Outcome)
- "Share the wealth" toggle (default on) governs spread vs concentrate. (Outcome / Business rule)
- A downvote spends from the round budget and no longer docks a lifetime score. (Outcome)
- Downvote settings are host-controlled and enforced server-side (reject a downvote when forbidden). (Business rule)
- A player cannot vote for their own submission (existing rule endures). People requirement.
- The budget applies until the voting window closes — which `RT-1` provides. (Cross-issue dependency.)

Existing seams/contracts to preserve:
- `cast_vote`'s own-submission rule (server.js:1320) and the connected-voter check (1335).
- Scoring's winner-resolution order (public override → Judge pick → popular vote) — unchanged.
- Per-round budget usage on `theme` auto-resets; no migration. Additive settings.
- The voting close from `RT-1` is the terminal window for budget spend; do not re-implement a separate close.

## Done when

- A player with a budget can spend it across multiple votes on other players' submissions, and cannot exceed the budget.
- With "Share the wealth" on (default), a player must spread points across at least two submissions; with it off, the whole budget can go on one.
- The budget resets at the start of each round so a player can vote fully next round.
- A downvote spends `downvoteCost` from the round budget and does not also dock a lifetime score; a crafted downvote when the group forbids downvotes is rejected server-side.
- The client shows a player's remaining budget and enforces the spread/concentrate rule in the UI.
- `web-app/e2e/round-phases.spec.js` and `round-deadline.spec.js` pass (with the "cast once to complete" loops already reworked by `RT-1`), plus new budget/`Share the wealth`/downvote tests in the full chromium suite.
- `cd web-app && npm run lint` shows no new errors (23 pre-existing warnings are the baseline).

## Depends on

- [`RT-1`](RT-1.md) — the voting window close must be in place so the budget applies until that close.