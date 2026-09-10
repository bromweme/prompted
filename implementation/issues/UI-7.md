# UI-7 — Group Rules edit form: inputs full-bleed, checkboxes detached from labels, sections stack one-per-row

- **Status:** In progress (Wave 9 — paired with UI-1). CSS-only. **Coordinate with `UI-1`** — both change `.form-row input, .form-row select { flex: 1 }` in `GroupView.css`.
- **Priority:** medium
- **Guarantee:** In the Group Rules **edit form** (host has clicked "Edit Rules"), number inputs are a sensible width (not full row), each checkbox sits directly beside its label, and the rules sections lay out at least two across on a wide screen. The read-only Rules view is already correct and must stay that way.

## When it happens

**Only while editing the rules.** The bug is in the rules **edit form** — the state after the host clicks **Rules → "Edit Rules"** (`isEditingRules`, `.rules-edit-form`, `GroupView.jsx:1522-1523`). The read-only Rules view (what everyone sees before "Edit Rules") is fine and already lays out ~3 sections across. All three symptoms below appear only in edit mode.

## Observed (verified in the running app)

Group Rules → "Edit Rules". Computed styles on the edit form:

- `.rules-edit-form .form-row input[type="number"]` → `flex: 1 1 0%`, `width: 1221px`, `max-width: none`. Every "Total Rounds", "Max Players", "Points for Judge's Pick", "Max Jury Points" field stretches the full row.
- `.rules-edit-form .form-row.checkbox input[type="checkbox"]` → `flex: 1 1 0%`, `width: 1181px`. The checkbox's box is stretched across the row; the visible tick sits at the far left and the label text ("Allow members to invite others", "Anonymous Judge", "Allow Skip Judge") is pushed to the far right.
- `.rules-edit-form` → `display: flex; flex-direction: column`. Each `.rules-section` (Game Settings, Judge Rules, Jury Rules, Override Rules, Timing, Additional Features, Topic Settings) is a full-width row, so the edit form is very long.

Note: the **read-only** Rules view already lays sections out ~3 across (`.rules-container`, `GroupView.css:597-601`: `grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr))`). Only the **edit** form stacks.

## Root cause

All in `web-app/src/pages/GroupView.css`:

1. `:677-680` — `.form-row input, .form-row select { flex: 1 }`. `flex: 1` = `1 1 0%`, so inputs grow to fill the row with no cap. This rule also matches `<input type="checkbox">` inside `.form-row.checkbox` (`.form-row.checkbox input[type="checkbox"]` at `index.css:430` sets only `width/height`, not `flex`), so the checkbox box is stretched too. (This is the same rule `UI-1` needs changed — there it leaks into `/create-group` and collapses the unit `<select>`.)
2. `:701-707` — `.form-row.checkbox label { flex: 1 }` makes the label a full-width flex row; combined with the stretched checkbox above, the tick and the text end up at opposite ends.
3. `:638-648` — `.rules-edit-form { display: flex; flex-direction: column }` and `.rules-edit-form .rules-section { display: flex; flex-direction: column }`: one section per row.

## Requested changes

1. Number/text inputs on `.form-row` get a bounded width (not full-bleed).
2. Checkbox sits next to its label again.
3. The rules **sections** in edit mode lay out two (or more) across on a wide screen, so the page is shorter.

## Proposed fix (CSS only)

- `GroupView.css:677` — exclude checkbox/radio and cap the width, e.g.
  `.form-row input:not([type="checkbox"]):not([type="radio"]), .form-row select { flex: 0 1 auto; width: 220px; max-width: 100%; }`
  (or scope to `.group-view-page` and keep a `flex` that doesn't zero the basis). Confirm this also satisfies `UI-1` for the CreateGroup `.window-control select`, or land the two together.
- `GroupView.css` — ensure `.form-row.checkbox input[type="checkbox"] { flex: 0 0 auto; }` so the box stays 18px; keep the label content left-aligned (checkbox then text). The label may stay `flex: 1` for a full-width click target — verify the text hugs the checkbox once the box is 18px.
- `GroupView.css:638` — give `.rules-edit-form` the same grid as `.rules-container`: `display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: var(--space-4);` (drop `flex-direction: column`). Keep `.rules-edit-form .rules-section` as an internal column. The `@media` block at `:1112-1121` that stacks `.form-row:not(.checkbox):not(.textarea-row)` on narrow screens must still work. Keep the full-width `.form-actions` row (Save/Cancel) spanning all columns.

## Affected surface

| Area | Change |
|---|---|
| `web-app/src/pages/GroupView.css` | The three rules above; check the read-only `.rules-container`, the Create Group wizard (shared `.form-row` classes), and the round-view `.window-control` are unaffected. |
| e2e | No layout assertions today, but `round-phases`/`modals` interact with rules checkboxes by role/label — run the full suite. Consider a focused check that a rules number input is narrower than its row and a checkbox label is within ~30px of its checkbox. |

## Done when

- In the Rules edit form: number inputs are ~200–240px (not full row); each checkbox is immediately left of its label text; sections show 2+ per row at desktop width and collapse to one column when narrow.
- Read-only Rules view, Create Group wizard, and the round-view timing controls are visually unchanged (or improved, for the `UI-1` overlap).
- `cd web-app && npm run lint` no new errors (23 baseline warnings).
- Full `cd web-app && npx playwright test` green.

## Depends on

None, but **must be sequenced with `UI-1`** (shared `.form-row input/select` rule).
