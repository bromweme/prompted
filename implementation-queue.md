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
| Wave 5 | (pending) | `REP-RT2-1` | **In progress.** Zero-point budget-bypass repair: require positive `points`/`downvoteCost` in `cast_vote` + regression. Unblocks `RT-2`. |

## Ready frontier

The current dependency-free frontier. An issue is listed here only when every issue it depends on is `Done`.

| Id | Issue |
|---|---|
| `RT-3` | Judge can skip their turn, with a fair no-repeat rotation — `docs/planning/gameplay-round-timing-product-brief.md` |

| Id | Issue |
|---|---|
| `HG-1` | Members can leave or elect a new host when the host has abandoned the group — `docs/planning/host-governance-product-brief.md` |

## In progress (Wave 5)

| Id | Issue |
|---|---|
| `REP-RT2-1` | Zero-point votes bypass the round budget and can manipulate the winner (unblocks `RT-2`) |

## Done (Wave 4)

| Id | Issue |
|---|---|
| `REP-RT1-1` | Minute window lengths that aren't whole hours round-trip to a larger whole hour |

## Blocked

| Id | Issue | Blocked by |
|---|---|---|
| `RT-2` | Per-round vote budget with "Share the wealth" and a single downvote cost | `REP-RT2-1` (zero-point budget bypass — closure blocker) |

The `GL-1/GL-2/GL-3` wave and its `REP-GL1-1` / `REP-GL1-2` repairs are all `Done` (Waves 1-2). Wave 3 (`RT-1`, timed windows) is `Done`. Wave 4: `REP-RT1-1` (minute-window round-trip) is `Done`; `RT-2` (vote budget) is `Implemented` but blocked by `REP-RT2-1`. Wave 5 (`REP-RT2-1`) is **In progress**; once it lands and passes review, `RT-2` reaches `Done`. `RT-3` and `HG-1` remain ready for later waves.

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