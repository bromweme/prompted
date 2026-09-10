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

## Ready frontier

The current dependency-free frontier. An issue is listed here only when every issue it depends on is `Done`.

| Id | Issue |
|---|---|
| `RT-2` | Per-round vote budget with "Share the wealth" and a single downvote cost — `docs/planning/gameplay-round-timing-product-brief.md` |

| Id | Issue |
|---|---|
| `RT-3` | Judge can skip their turn, with a fair no-repeat rotation — `docs/planning/gameplay-round-timing-product-brief.md` |

| Id | Issue |
|---|---|
| `HG-1` | Members can leave or elect a new host when the host has abandoned the group — `docs/planning/host-governance-product-brief.md` |

| Id | Issue |
|---|---|
| `REP-RT1-1` | Minute window lengths that aren't whole hours round-trip to a larger whole hour (non-blocking follow-up from RT-1 closure) |

## Blocked

| Id | Issue | Blocked by |
|---|---|---|
| none | |

The `GL-1/GL-2/GL-3` wave and its `REP-GL1-1` / `REP-GL1-2` repairs are all `Done` (Waves 1-2). Wave 3 (`RT-1`, timed windows) is `Done` (closure review NON-BLOCKING). The next wave frontier opens with `RT-2`, `RT-3`, `HG-1`, and `REP-RT1-1` all ready. `RT-2` (per-round vote budget) builds directly on the now-stable RT-1 voting-close seam. `REP-RT1-1` is a small non-blocking client fix on the RT-1 surface.

## Out of scope for now (tracked as notes, not ready issues)

These are real findings but are deliberately **not** ready implementation issues in this wave. Leave them as notes until a wave owns them:

- **`allowDownvotes` was not server-enforced** (finding `f.settings`): now owned by `RT-2` (per-round vote budget), which enforces `allowDownvotes` server-side. Note retained for history.
- **Voting had no deadline or host escape** (finding `f.deadline`): now owned by `RT-1` (two timed windows, voting closes on its deadline). The design/decision is settled (`docs/design/a1-voting-deadline-change-design.md`, `docs/design/a4-round-windows-change-design.md`). Note retained for history.
- **`maxPlayers` / `totalRounds` are displayed as limits but never enforced** (finding `f.settings`): implementing enforcement changes product semantics (does a group end at `totalRounds`? is it a standing league?). Needs a product decision first.
- **Song preview, chat, voter identity, auto-start, skip-Judge settings are inert** (finding `f.settings`): removing, wiring, or completing them is a product decision, not a bug fix.
- **Session tokens cannot be revoked** (finding `f.norevoke`): a security change with its own review; needs scoping.
- **Account Settings toggles are cosmetic and Deactivate is a stub** (finding `f.ui-dead`): separate surface from the group wave; needs a product decision on what the toggles should do.
- **Downvote previously charged the voter as well as the target** (finding `f.downvote`): resolved as a desirable single-cost decision in `RT-2` (downvote spends only from the round budget; the lifetime score dock is removed). Note retained for history.
- **Judge loses the "Select as Winner" control after voting** (RT-1 closure observation): once the Judge casts a vote, GroupView switches to "You've voted — waiting for the rest of the group" and hides the `isRoundLeader`-gated winner control, so in a 2-player round the Judge cannot reveal early via the UI after voting (the voting deadline still closes the round, and the server still honors a Judge's `czar_select_winner`). Consistent with the no-early-reveal design (A1/A4), but a UX gap on the surface RT-1 ships. `RT-2` reworks this exact voting panel for the vote budget; re-assess there rather than a separate issue.