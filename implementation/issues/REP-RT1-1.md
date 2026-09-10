# REP-RT1-1 — Minute window lengths that aren't whole hours round-trip to a larger whole hour

- **Status:** In progress (Wave 4)
- **Priority:** medium
- **Guarantee to restore:** A host-chosen window length must survive a round-trip (set → read back → re-save) without silently changing. A 90-minute voting (or submission) window must stay 90 minutes, not silently become 2 hours.
- **Blocks:** none (does not gate `RT-1`; the running round's absolute deadline is correct)
- **Depends on:** none

## Failed behavior

`web-app/src/utils/windowLengths.js` maps a persisted hours value back to the edit form's value+unit via `hoursToWindowValue` (`:43-54`). For any value that totals more than one hour but is not a whole number of hours, the function falls through to the `hours` branch and applies `Math.round`:

- `hoursToWindowValue(1.5)` → neither `h < 1` nor `h % 24 === 0` → `{ value: Math.round(1.5) = 2, unit: 'hours' }`.
- If the host then re-saves, `windowValueToHours(2, 'hours') = 2`, silently growing a 90-minute window to 120 minutes.
- Same for 150 min (2.5h → "3 hours"), 210 min (3.5h → "4 hours"), etc.

The active round's already-persisted absolute `theme.deadline` is **not** affected — it is an absolute instant set from the true value. The corruption is confined to the edit-form display and to whichever round is created/edited after a re-save goes through the rounded form.

## Trigger

A host sets a submission or voting window in minutes where the total exceeds one hour but is not a whole hour (e.g., 90 minutes). Opening the Rules editor / Overview shows the wrong value, and re-saving changes the stored hours.

## Affected flow

1. Host sets voting window to 90 minutes in CreateGroup → `windowValueToHours(90, 'minutes') = 90 * (1/60) = 1.5`, persisted as `votingTime: 1.5`.
2. Round runs on a correct 1.5h deadline.
3. Host opens the Rules editor → `hoursToWindowValue(1.5)` returns `{ value: 2, unit: 'hours' }`, displayed as "2 hours".
4. Host re-saves → `windowValueToHours(2, 'hours') = 2`, so a future round gets a 2-hour (120 min) window instead of the intended 90 min.

Components that must change: `web-app/src/utils/windowLengths.js` (`hoursToWindowValue`). The `h < 1` and `h % 24 === 0` branches already handle whole-hour and sub-hour values cleanly; the defect is the `Math.round` on the remainder branch.

## Repair requirements

- A persisted hours value that is not a whole hour must round-trip back to the same window when re-saved through the edit form (within the form's whole-number integer constraint). The fix should represent sub-hour-but-multi-hour windows in minutes (e.g., 1.5h → "90 minutes") rather than rounding them up to a whole hour.
- The displayed value must not lie about the stored window, and re-saving must not change the persisted hours.
- Carries a focused regression: set a 90-minute (and 150-minute) window via the CreateGroup wizard, assert the Rules editor shows 90 (150) minutes, re-save, and assert `votingTime`/`submissionTime` is unchanged at 1.5 (2.5) hours.

## Done when

- `hoursToWindowValue` returns a value+unit that, when passed back through `windowValueToHours`, reproduces the exact stored hours for every value the edit controls can produce (including minute windows of 90, 150, 210 minutes and whole-hour/day windows).
- A focused regression check covers at least 90 and 150 minutes: display is correct and re-save preserves the stored value.
- `cd web-app && npm run lint` shows no new errors (23 pre-existing warnings are the baseline).

## Depends on

None.
