# REP-UI7-1 — `.rules-edit-form` grid columns are too narrow for the rigid 180px label + rules number input; rows overflow their section

- **Status:** In progress (Wave 9 repair; blocking `UI-1`, `UI-7`)
- **Priority:** high (blocking)
- **Guarantee to restore:** In the Group Rules edit form, at any desktop viewport that lays sections out 2+ across, every numeric `.form-row` (and the Timing `.window-control` row) fits inside its `.rules-section` — no horizontal overflow, no overlapping sections, and the number input renders at a usable width (not squeezed toward 0px).
- **Blocks:** `UI-1` (its "GroupView Rules editor timing controls are unchanged" done condition), `UI-7` (its own core "bounds its fields" / "sections show 2+ per row" done condition)
- **Depends on:** none

## Failed behavior

Confirmed independently by both the change-reviewer and the adversarial-reviewer against commit `20cf374` (Wave 9), same root cause:

`GroupView.css:642-646` changed `.rules-edit-form` to `display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr))`. At any width that yields 3 columns (e.g. the new spec's own 1400px viewport → ~305px tracks), a `.rules-section` inner content box is ~273px and its `.form-row` inner content box is ~257px. Inside that row:

- `GroupView.css:680-684` `.rules-edit-form .form-row label { flex: 0 0 180px }` is rigid (`flex-shrink: 0`) — 180px + a 16px gap leaves only ~61px for the input.
- `GroupView.css:701-704` `.rules-edit-form .form-row > input[type="number"] { width: 240px; max-width: 100% }` has **no `min-width: 0`**, so as a flex item its automatic minimum is its content-based intrinsic width (well above 61px, roughly 150-165px for a styled number input) — it will not shrink into the available space. `180 + 16 + ~155 > 257` ⇒ the row overflows its section.
- The Timing rows (`.window-control`, label 180 + rigid unit `<select>` ~100px + gaps) have effectively zero slack even before the number input, squeezing the `.window-control` number input toward 0px.
- Because the grid track floor (`minmax(300px, …)`) is a fixed length, the grid algorithm does not widen the track to the row's content-based minimum — the overflow persists at every multi-column width (1400px, 1920px, 2560px all reproduce it). Only a forced single column, or the existing `@media (max-width: 768px)` stacking, avoids it.

Contrast: the codebase already solved exactly this hazard one level deeper — `GroupView.css:723-726` `.group-view-page .window-control input[type="number"] { flex: 1 1 auto; min-width: 0 }` — the new rules-form rule omits the `min-width: 0` that pattern relies on.

## Trigger

Host opens a group, clicks **Rules → Edit Rules**, at any desktop viewport ≥ roughly 1000px wide (the normal case — this is not an edge width).

## Affected flow

1. `beginRound`/group setup is irrelevant; this is pure layout. Host clicks "Edit Rules" → `isEditingRules` renders `.rules-edit-form` (`GroupView.jsx:1522` onward).
2. `.rules-edit-form` is a CSS grid with a fixed-length track minimum (300px) → at typical desktop widths it lays out 2-4 columns.
3. Every numeric `.form-row` (`#rules-total-rounds`, `#rules-max-players`, `#rules-czar-points`, `#rules-max-jury-points`, `#rules-vote-budget`, `#rules-downvote-cost`, `#rules-override-threshold`) and the Timing `.window-control` rows (`#rules-submission-time`, `#rules-voting-time`) do not fit the resulting column width, given the rigid 180px label.
4. Result: visible horizontal overflow / overlapping `.rules-section` cards, and the Timing number inputs squeezed toward unusable width.

Components that must change: `web-app/src/pages/GroupView.css` only (`.rules-edit-form` grid track sizing and/or the numeric input's flex/min-width). No JS/JSX change expected.

## Repair requirements

- Every `.rules-edit-form` numeric `.form-row` and the Timing `.window-control` rows must fit inside their `.rules-section` at any viewport ≥ ~1000px — no overflow, no overlapping sections.
- The rules number input must render at a genuinely usable width (a reasonable floor, e.g. not below ~110-120px) rather than being squeezed toward 0.
- Sections must still lay out 2+ across on a normal desktop width (don't regress back to one-per-row to "fix" this — the whole point of `UI-7` was to shorten the page).
- Add `min-width: 0` to `.rules-edit-form .form-row > input[type="number"]`, matching the established pattern already used for `.group-view-page .window-control input[type="number"]` (`GroupView.css:723-726`) — this alone prevents overflow but, alone, may squeeze the input too narrow; combine with a wider grid track floor sized to actually fit a full row (label 180px + gap + a comfortable input, e.g. `minmax(380px, 1fr)` or similar — compute against the real section/row padding) so 2-column layouts stay comfortable rather than merely non-overflowing.
- Strengthen the regression test: `rules-layout.spec.js`'s current assertions (`numWidth < 300`, `numWidth < numRowWidth * 0.6`) pass even while the row overflows its section — they do not catch this defect (confirmed false-green by both reviewers). Add an explicit no-overflow assertion (e.g. `.rules-edit-form.scrollWidth <= .rules-edit-form.clientWidth`, and/or each `.form-row`'s right edge within its `.rules-section`'s content-box right edge) and a usable-width floor for the Timing number input.

## Done when

- At the existing spec's 1400px viewport AND at least one wider case (e.g. 1920px): `.rules-edit-form` and `.group-main-content` have no horizontal overflow (`scrollWidth <= clientWidth`); no two `.rules-section` elements have overlapping bounding boxes; every `.form-row`'s right edge stays within its `.rules-section` content box.
- Every rules numeric input and the Timing `.window-control` number inputs render at a usable width (define and assert a floor, e.g. `> 60px`, consistent with UI-1's own threshold for the CreateGroup select).
- Sections still lay out 2+ per row at desktop width (don't regress to one column).
- The existing `UI-1` CreateGroup fix and the read-only `.rules-container` view remain unaffected (both already confirmed clean by review — don't touch that path).
- `cd web-app && npm run lint` no new errors (23 baseline warnings).
- Full `cd web-app && npx playwright test` green, including the strengthened `rules-layout.spec.js`.
