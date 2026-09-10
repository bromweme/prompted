# Prompted — Implementation Queue

The authoritative issue graph for implementation work. Built from the deep-discovery package (`docs/discovery/`) and maintained in place by `work-on-issues` waves.

Every issue file lives in [`implementation/issues/`](implementation/issues/). Each issue is in exactly one state. The `Ready` frontier is recomputed whenever a state or dependency changes.

## States

`Ready` — all prerequisites `Done`; may enter a wave.
`In progress` — selected for the current wave or has unresolved work.
`Blocked` — cannot proceed because of a real prerequisite, external condition, or a required Planning/Design decision.
`Implemented` — implementation and wave checks passed; independent review has not yet cleared it.
`Done` — independent review found no blocking defect.

## Wave history

| Wave | Commit | Issue ids | Outcome |
|---|---|---|---|
| Wave 1 | `8253c51` | `GL-1`, `GL-2`, `GL-3` | GL-2, GL-3 `Done`; GL-1 `Implemented` (review-work). Review filed `REP-GL1-1` (host-leave orphan) and `REP-GL1-2` (client-navigation test gap), both `Ready`, blocking GL-1. |
| Wave 2 | `0964c00` | `REP-GL1-1`, `REP-GL1-2` | Both repair issues `Done` (closure review passed, review-work). Server rejects host `leave_group` so a group always keeps a host who is a current member; `leave-delete.spec.js` gained two browser click→navigate tests. Full chromium suite 76/76 green; oxlint 0 errors. `GL-1` now `Done`. |
| Wave 3 | `9695517` | `RT-1` | Timed submission & voting windows land; voting closes on its deadline (no early reveal); host sets each window with numeric value + unit with boundary clamping. Full chromium suite 77/77 green; oxlint 0 errors/23 baseline warnings. Closure review (change + adversarial) NON-BLOCKING; `RT-1` now `Done`. Non-blocking follow-up `REP-RT1-1` (minute-window round-trip) filed `Ready`. `RT-2` is unblocked. |
| Wave 4 | `b784369` | `RT-2`, `REP-RT1-1` | `RT-2` = per-round vote budget (default 10), "Share the wealth" spread/concentrate toggle, downvote spends only from budget, server-enforced `allowDownvotes` and downvote-lifetime-dock removal; `voteBudgetRemaining` contract. `REP-RT1-1` = minute-window round-trip fix in `windowLengths.js` + regression spec. Full chromium suite 84/84 green; oxlint 0 errors/23 baseline warnings. Closure review (change + adversarial) split: `REP-RT1-1` NON-BLOCKING → `Done`; `RT-2` BLOCKING (adversarial found DEF-1: zero-point votes bypass the budget and can force `public_override`) → stays `Implemented`, repair `REP-RT2-1` filed `Ready`. |
| Wave 5 | `1f25e44` | `REP-RT2-1` | Zero-point budget-bypass repair: `cast_vote` rejects upvotes with `points <= 0`; new `clampDownvoteCost` (min 1) applied to `downvoteCost` in settings and at cast time so a downvote always spends budget. Regression added to `vote-budget.spec.js`. Full chromium suite 88/88 green; oxlint 0 errors/23 baseline warnings. Closure review split: change-reviewer NON-BLOCKING, but adversarial found `REP-RT2-1-FRAC` — non-integer upvote points (no `Number.isInteger` check) re-open the unbounded vote-count `public_override` pump. `REP-RT2-1` stays `Implemented`, blocked by new repair `REP-RT2-2`. |
| Wave 6 | `14c6e14` | `REP-RT2-2` | Fractional-points repair: `cast_vote` now requires `Number.isInteger(points) && points >= 1`, rejecting fractions (`0.1`/`1e-9`) that could be spent as an unbounded vote-count `public_override` pump. Regression added to `vote-budget.spec.js`. Full chromium suite 90/90 green; oxlint 0 errors/23 baseline warnings. Closure review (change + adversarial) NON-BLOCKING → `REP-RT2-2` `Done`. This clears the vote-budget chain: `REP-RT2-1` and `RT-2` are now `Done`. |
| Wave 7 | `6c428d0` | `RT-3`, `HG-1` | Final wave: `RT-3` (Judge skip, fair no-repeat rotation across rounds) + `HG-1` (host-abandonment election with durable `lastSeenAt`, majority transfer, return-cancels). Both `Implemented`, awaiting closure review. Full chromium suite 100/100 green; oxlint 0 errors/23 baseline warnings. |

## Implemented (Wave 7, awaiting closure review)

| Id | Issue |
|---|---|
| `RT-3` | Judge can skip their turn, with a fair no-repeat rotation |
| `HG-1` | Members can leave or elect a new host when the host has abandoned the group |

## Done

| Id | Issue |
|---|---|
| `GL-1`, `GL-2`, `GL-3` | Leave/Delete, EditVideo/Overview, Dashboard dead controls (Waves 1-2) |
| `REP-GL1-1`, `REP-GL1-2` | GL-1 repairs (Waves 2) |
| `RT-1` | Two timed round windows (Wave 3) |
| `REP-RT1-1` | Minute-window round-trip fix (Wave 4) |
| `RT-2` | Per-round vote budget + "Share the wealth" + single downvote cost (Wave 4 + repairs) |
| `REP-RT2-1` | Zero-point budget bypass (Wave 5) |
| `REP-RT2-2` | Fractional-points vote-count pump (Wave 6) |

## Blocked

| Id | Issue | Blocked by |
|---|---|---|
| none | |

The `GL-1/GL-2/GL-3` wave and its `REP-GL1-1` / `REP-GL1-2` repairs are `Done` (Waves 1-2). Wave 3 (`RT-1`) and Wave 4 (`RT-2` + `REP-RT1-1`) are `Done`. Wave 5 (`REP-RT2-1`) and Wave 6 (`REP-RT2-2`) are `Done`, clearing the vote-budget feature. Wave 7 (`RT-3` Judge skip + `HG-1` host election) is `Implemented`, awaiting closure review — the final two issues. Once they pass review, every issue in the backlog is `Done`.

## Out of scope for now (tracked as notes, not ready issues)

These are real findings but are deliberately **not** ready implementation issues in this wave. Leave them as notes until a wave owns them:

- **`allowDownvotes` was not server-enforced** (finding `f.settings`): now owned by `RT-2` (per-round vote budget), which enforces `allowDownvotes` server-side. Note retained for history.
- **Voting had no deadline or host escape** (finding `f.deadline`): now owned by `RT-1` (two timed windows, voting closes on its deadline). The design/decision is settled (`docs/design/a1-voting-deadline-change-design.md`, `docs/design/a4-round-windows-change-design.md`). Note retained for history.
- **`maxPlayers` / `totalRounds` are displayed as limits but never enforced** (finding `f.settings`): implementing enforcement changes product semantics (does a group end at `totalRounds`? is it a standing league?). Needs a product decision first.
- **Song preview, chat, voter identity, auto-start, skip-Judge settings are inert** (finding `f.settings`): removing, wiring, or completing them is a product decision, not a bug fix.
- **Session tokens cannot be revoked** (finding `f.norevoke`): a security change with its own review; needs scoping.
- **Account Settings toggles are cosmetic and Deactivate is a stub** (finding `f.ui-dead`): separate surface from the group wave; needs a product decision on what the toggles should do.
- **Downvote previously charged the voter as well as the target** (finding `f.downvote`): resolved as a desirable single-cost decision in `RT-2` (downvote spends only from the round budget; the lifetime score dock is removed). Note retained for history.
- **Judge loses the "Select as Winner" control after voting** (RT-1 + RT-2 closure observations): both closure reviews confirmed the gap persists — once the Judge spends their whole budget, `voteBudgetSpent` flips and hides the `isRoundLeader`-gated winner control (GroupView ~1111-1174), so in a 2-player round the Judge cannot reveal early via the UI after a full-budget vote. The server still honors a Judge's `czar_select_winner` and the voting deadline still closes the round, so no done condition is violated; it is a UX gap. Consistent with the no-early-reveal design (A1/A4). Not yet owned by a wave; re-assess when the voting panel is next reworked.