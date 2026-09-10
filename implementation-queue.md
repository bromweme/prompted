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
| Wave 7 | `6c428d0` | `RT-3`, `HG-1` | Final wave: `RT-3` (Judge skip, fair no-repeat rotation across rounds) + `HG-1` (host-abandonment election with durable `lastSeenAt`, majority transfer, return-cancels). Both `Implemented`, awaiting closure review. Full chromium suite 100/100 green; oxlint 0 errors/23 baseline warnings. Closure review (change + adversarial) split: `HG-1` NON-BLOCKING → `Done`; `RT-3` BLOCKING (adversarial found `REP-RT3-1` — a Judge assigned via a skip or a host hand-pick is never recorded in the served set, so they can be re-drafted before an unserved member gets a turn) → stays `Implemented`, blocked by repair `REP-RT3-1`. |
| Wave 7 repair | `35e1d31` | `REP-RT3-1` | No-repeat-rotation repair: judges are now recorded as having served when they actually PLAY (`select_topic` picks a topic), not at the moment of assignment. So a skip-assigned / host-hand-picked Judge who plays is added to `judgeUseCase` and cannot be re-drafted before an unserved member gets a turn, while the full-skip-revert branch stays reachable. Full chromium suite 101/101 green; oxlint 0 errors/23 baseline warnings. Closure review (change + adversarial) NON-BLOCKING → `REP-RT3-1` `Done`. This unblocks and closes `RT-3`. |
| Wave 8 | `f97dbfc` | `RT-4` | Display-only bug: the Overview and Round tabs formatted `currentTheme.deadline` at three sites with no null guard, so during `topic_selection` (deadline is `null` by design until the Judge picks a topic) they rendered `new Date(null)` — an epoch date (observed "12/31/1969 at 7:00:00 PM") and a large negative "hours" value. Fix confined to `web-app/src/pages/GroupView.jsx`: shared `formatDeadline` / `formatHoursRemaining` helpers return a "Not set yet" placeholder when the deadline is absent or invalid; real deadlines render exactly as before. New UI regression `round-deadline-display.spec.js` (proven red against pre-fix code). oxlint 0 errors / 23 baseline warnings. Full suite green (2 unrelated WebKit `round-phases:211` YouTube-search flakes pass on isolated re-run). Initial review (change + adversarial) NON-BLOCKING → `RT-4` `Done`. Follow-up commit added `context.close()` cleanup to the new spec (adversarial non-blocking note). |

## Done

| Id | Issue |
|---|---|
| `RT-4` | Round deadline UI showed `new Date(null)` (Unix epoch) before a topic is picked — null-guarded the three readouts (Wave 8) |
| `GL-1`, `GL-2`, `GL-3` | Leave/Delete, EditVideo/Overview, Dashboard dead controls (Waves 1-2) |
| `REP-GL1-1`, `REP-GL1-2` | GL-1 repairs (Wave 2) |
| `RT-1` | Two timed round windows (Wave 3) |
| `REP-RT1-1` | Minute-window round-trip fix (Wave 4) |
| `RT-2` | Per-round vote budget + "Share the wealth" + single downvote cost (Wave 4 + repairs) |
| `REP-RT2-1` | Zero-point budget bypass (Wave 5) |
| `REP-RT2-2` | Fractional-points vote-count pump (Wave 6) |
| `HG-1` | Host-abandonment election (Wave 7 closure) |
| `RT-3` | Judge can skip their turn, fair no-repeat rotation (Wave 7 + REP-RT3-1) |
| `REP-RT3-1` | No-repeat rotation records Judges by play, not assignment (Wave 7 repair) |

## Ready

| Id | Issue | Notes |
|---|---|---|
| `UI-1` | Create Group timing-unit dropdown collapses; "minutes / hours / days" label is clipped | Triage batch (user-reported, replicated). CSS-only. Unscoped `.form-row select { flex: 1 }` in `GroupView.css:677` leaks app-wide and collapses the wizard's `.window-control select`. See `implementation/issues/UI-1.md`. |
| `UI-2` | Group code is a guessable `GROUP<timestamp>_<n>`; shareable link is long / unpolished | Triage batch (user-reported). Server + client. Replace the timestamp id with a CSPRNG letter code (proposed `A-Z`×20); serve a clean `/join/<code>` link. Has a security component (the id is also the only join secret). Needs a quick product sign-off on alphabet/length and link scheme before a wave. See `implementation/issues/UI-2.md`. |
| `UI-3` | "Start Group" button: rename to "Start Round", use the active primary style | Triage batch (user-reported). JSX + CSS-class only. `GroupView.jsx:809` uses `setup-button secondary` (grey outline on a grey panel — reads as disabled) and the label is inconsistent with "Start Round"/"Start Next Round" elsewhere. Switch to `primary` + rename; update the e2e specs that click by exact text. See `implementation/issues/UI-3.md`. |
| `UI-4` | "Current Theme" section shows an empty theme + boilerplate before a theme is picked | Triage batch (user-reported, reviewed). JSX + CSS. During `topic_selection`, both the Overview card (`GroupView.jsx:847`) and the Round tab (`:982`) render `<h3>Current Theme</h3>`, an empty `<h4>` title, and the static `description` "This round's music challenge". Gate on `title`: conditional heading (wording options in the issue), hide the empty title + description until a theme is chosen. Also fixes the run-together `SUBMISSIONS0` / `DEADLINENot set yet` stat spacing found during review. See `implementation/issues/UI-4.md`. |
| `UI-5` | Remove the "Quick Theme Inspiration" section from the My Topics page | Triage batch (user-reported). JSX + CSS delete in `ThemeIdeas.jsx:113-141` + dead `.quick-idea*` rules in `ThemeIdeas.css`. `/account` has a near-identical section, left untouched. The suggestions concept is kept for later — see the out-of-scope note. See `implementation/issues/UI-5.md`. |
| `UI-6` | Rename "topic" → "prompt" (page, route, references) | Triage batch (user-reported). **Blocked on product decisions**: surface-only rename vs full rename (wire events + `topic_selection` phase string + `topics` DB table + persisted keys, ~430 sites + a `prompted.db` migration), and whether "prompt" also replaces the interchangeable "theme" wording. ~430 "topic" refs across server/src/e2e. See `implementation/issues/UI-6.md`. |
| `UI-7` | Group Rules edit form: inputs full-bleed, checkboxes detached from labels, sections stack one-per-row | Triage batch (user-reported, verified in-app). CSS-only in `GroupView.css`. `.form-row input, .form-row select { flex: 1 }` (`:677`) full-bleeds number inputs **and** stretches checkbox boxes (tick left, label far right); `.rules-edit-form` is `flex-direction: column` so the 7 sections stack. Fix: bounded input width + exclude checkboxes; grid the edit sections 2+ across like the read-only `.rules-container`. **Shares the `.form-row input/select` rule with `UI-1` — sequence together.** See `implementation/issues/UI-7.md`. |

## Blocked

| Id | Issue | Blocked by |
|---|---|---|
| none | |

The `GL-1/GL-2/GL-3` wave and its `REP-GL1-1` / `REP-GL1-2` repairs are `Done` (Waves 1-2). Wave 3 (`RT-1`) and Wave 4 (`RT-2` + `REP-RT1-1`) are `Done`. Wave 5 (`REP-RT2-1`) and Wave 6 (`REP-RT2-2`) are `Done`, clearing the vote-budget feature. Wave 7 (`RT-3` Judge skip + `HG-1` host election) and its `REP-RT3-1` repair are all `Done`. Wave 8 (`RT-4`, deadline-display null guard) is `Done` (initial review passed). All prior waves are `Done`; a fresh triage batch of user-reported UI bugs is being collected — `UI-1`–`UI-5` and `UI-7` are `Ready` (`UI-1` + `UI-7` share a CSS rule — sequence together); `UI-6` (topic→prompt rename) is `Blocked` on a scope decision, more may follow before the next wave starts.

## Out of scope for now (tracked as notes, not ready issues)

These are real findings but are deliberately **not** ready implementation issues in this wave. Leave them as notes until a wave owns them:

- **`allowDownvotes` was not server-enforced** (finding `f.settings`): now owned by `RT-2` (per-round vote budget), which enforces `allowDownvotes` server-side. Note retained for history.
- **Voting had no deadline or host escape** (finding `f.deadline`): now owned by `RT-1` (two timed windows, voting closes on its deadline). The design/decision is settled (`docs/design/a1-voting-deadline-change-design.md`, `docs/design/a4-round-windows-change-design.md`). Note retained for history.
- **`maxPlayers` / `totalRounds` are displayed as limits but never enforced** (finding `f.settings`): implementing enforcement changes product semantics (does a group end at `totalRounds`? is it a standing league?). Needs a product decision first.
- **Song preview, chat, voter identity, auto-start, skip-Judge settings are inert** (finding `f.settings`): removing, wiring, or completing them is a product decision, not a bug fix.
- **Theme suggestions (was "Quick Theme Inspiration")** (from `UI-5`): the hard-coded six-card preset grid is being removed from `/topics` in `UI-5`. The user wants to come back to the idea of offering theme suggestions properly (curated or generated, not a static grid). Needs product/design when picked up.
- **Session tokens cannot be revoked** (finding `f.norevoke`): a security change with its own review; needs scoping.
- **Account Settings toggles are cosmetic and Deactivate is a stub** (finding `f.ui-dead`): separate surface from the group wave; needs a product decision on what the toggles should do.
- **Downvote previously charged the voter as well as the target** (finding `f.downvote`): resolved as a desirable single-cost decision in `RT-2` (downvote spends only from the round budget; the lifetime score dock is removed). Note retained for history.
- **Judge loses the "Select as Winner" control after voting** (RT-1 + RT-2 closure observations): both closure reviews confirmed the gap persists — once the Judge spends their whole budget, `voteBudgetSpent` flips and hides the `isRoundLeader`-gated winner control (GroupView ~1111-1174), so in a 2-player round the Judge cannot reveal early via the UI after a full-budget vote. The server still honors a Judge's `czar_select_winner` and the voting deadline still closes the round, so no done condition is violated; it is a UX gap. Consistent with the no-early-reveal design (A1/A4). Not yet owned by a wave; re-assess when the voting panel is next reworked.
- **HG-1 departed-member ballots are not purged from an in-flight election** (closure observation): `group.election.votes` keeps a departed member's ballot, and `electionMajorityNeeded` recomputes over the live member roster, so a scaled-down electorate counts stale votes toward the threshold. Both closure reviewers traced all paths and found **no reachable outcome where a departed candidate wins hostship** (any recompute that could promote a departed candidate is blocked because the candidate id ceases to be valid after departure; a solo electorate has no valid non-self target), so the non-member-host invariant holds. It is a robustness/fragility note only, not a defect; add explicit purge on `leave_group` whenever the election feature is next reworked.
- **REP-RT3-1 regression test is a probabilistic pre-fix red** (closure observation): the new judge-skip test "a skip-assigned Judge who plays is excluded from a later skip re-pick" deterministically asserts a valid state on the fixed code, but against the pre-fix bug its round-2 re-pick draws uniformly from two eligible members, so `.toBe(remainingUnserved.id)` fails on roughly ~50% of runs rather than every run. It covers the exact gap as the done-condition requires and the fix is confirmed by both closure reviewers plus a full 101/101 green suite; the probabilistic nature is a test-strength note, not a blocker. If the rotation bookkeeping is next reworked, consider asserting the skip-pool state directly or looping to make it a strict red on any regression.
- **A never-serving offline member can stall the rotation reset** (REP-RT3-1 adversarial observation, pre-existing, out of scope): `recordJudgeServed` resets the cycle only when `currentServed.length >= group.players.length`. If a member is offline and never serves, the set can never reach that size, so the full-skip-reset/revert path may not fire while they remain. This is a design consequence of the "set size == players.length" reset combined with presence-independent rounds (a round can begin with few connected members), not something introduced by `RT-3`/`REP-RT3-1`; note if rotation semantics are next reviewed.