# UI-1 — Create Group timing-unit dropdown collapses; its "minutes / hours / days" label is clipped

- **Status:** Ready (triage batch; not yet in a wave)
- **Priority:** medium
- **Guarantee:** In the Create Group wizard's "Timing Settings" step, each window's unit `<select>` (Submission Length, Voting Length) must be wide enough to show its selected label ("minutes" / "hours" / "days"), matching the same control in the GroupView Rules editor.

## Observed failure

Screenshot from the user, reproduced at `http://localhost:5173/create-group` → step 3 "Override & Timing" → "Timing Settings":

- The unit dropdown beside each numeric input renders as a ~34px box showing only the native chevron. No unit text is visible.
- The same value+unit control in GroupView's Rules editor (`.group-view-page .window-control select`) renders correctly.

Computed style on the broken select: `flex: 1 1 0%`, resolved `width: 34px`, `padding-left/right: 16px` each, `overflow: clip`. Padding alone (32px) exceeds the box width, so the option text has no room and is clipped.

## Root cause

`web-app/src/pages/GroupView.css:677-680` declares an **unscoped** rule:

```css
.form-row input,
.form-row select {
  flex: 1;
}
```

The stylesheets are plain global imports (no CSS Modules / scoping), so this rule applies app-wide. In `web-app/src/pages/CreateGroup.jsx` the unit select sits in `.form-row > .form-group > .window-control`, so `.form-row select` matches it.

`web-app/src/pages/CreateGroup.css:124` has `.window-control select { flex: 0 0 auto; }` — same specificity (0,1,1) as `.form-row select`, so the later-injected rule wins. `flex: 1` (→ `1 1 0%`) makes the select take `flex-basis: 0` and collapse.

GroupView's own editor escapes this because `GroupView.css:697` adds `.group-view-page .window-control select { flex: 0 0 auto; }` (specificity 0,2,1), which re-wins there. CreateGroup has no matching override.

## Affected flow

1. User opens Create Group → advances to step 3 "Override & Timing".
2. "Timing Settings" renders two `.window-control` rows, each `<input type="number">` + unit `<select>` (`CreateGroup.jsx:496-511`, `:518-533`).
3. Global `.form-row select { flex: 1 }` from `GroupView.css` collapses the select to arrow-only width; the unit label is clipped.

Component(s) that must change: CSS only — `web-app/src/pages/GroupView.css` and/or `web-app/src/pages/CreateGroup.css`. No JS/JSX change. The fix should stop the GroupView rule from leaking (scope it to `.group-view-page`, matching the sibling rules in that file) or give `.window-control select` a winning, self-contained rule in `CreateGroup.css`. Confirm no regression to: GroupView Rules editor timing controls, `Number of Rounds` / `Maximum Players` selects on wizard step 2, and any other `.form-row select` in the app.

## Done when

- On Create Group step 3, both unit dropdowns show their selected label ("hours" by default) and can be changed to "minutes" / "days" with the label visible.
- GroupView Rules editor timing controls are unchanged.
- Wizard step 2 selects (`6 Rounds`, `12 Players`) and every other `.form-row select` are unchanged.
- `cd web-app && npm run lint` shows no new errors (23 pre-existing warnings baseline).
- A focused Playwright regression opens the wizard to step 3 and asserts the unit select's rendered width is large enough to show text (e.g. `> 60px`) and that its accessible value/label is "hours".
- Full `cd web-app && npx playwright test` stays green.

## Depends on

None.
