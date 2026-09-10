# RT-4 — Round deadline UI renders `new Date(null)` as the Unix epoch before a topic is picked

- **Status:** Implemented (Wave 8) — awaiting initial review
- **Priority:** medium
- **Guarantee:** While a round is in its `topic_selection` phase (no submission clock started yet), the group UI must not present a fabricated deadline. It must show a plain "no deadline yet" placeholder instead of a date derived from `new Date(null)`.
- **Blocks:** none (display only; server timing is correct)
- **Depends on:** none

## Failed behavior

The server sets `theme.deadline` only when the Judge picks a topic (`server/server.js` `select_topic`, and the re-arm path). `beginRound` seeds `deadline: null` on purpose, so the time spent choosing a topic is not taken out of the players' submission window (`server/server.js:450-452`). `publicizeTheme` passes `deadline` through unchanged, so during `topic_selection` the client receives `currentTheme.deadline === null`.

`web-app/src/pages/GroupView.jsx` formats that value at three render sites without guarding for a missing deadline:

- Round tab, "Deadline" stat (`~972-974`): `new Date(group.currentTheme.deadline).toLocaleDateString()} at {new Date(group.currentTheme.deadline).toLocaleTimeString()`
- Overview tab, "Current Theme" card, "Deadline" stat (`~848`): `new Date(group.currentTheme.deadline).toLocaleDateString()`
- Overview tab, "Time Remaining" stat card (`~912`): `Math.ceil((new Date(group.currentTheme.deadline) - new Date()) / (1000 * 60 * 60))} hours`

`new Date(null)` is the Unix epoch (`1970-01-01T00:00:00Z`), so during `topic_selection` the first two show a date near "1/1/1970" (exact text depends on the viewer's time zone) and the third shows a large negative hours value.

## Trigger

Any member opens a group whose current round is in `topic_selection` (the state every round starts in, before the Judge selects a topic) and looks at the Overview tab or the Round tab.

## Affected flow

1. Host starts a round → `beginRound` creates `currentTheme` with `status: 'topic_selection'`, `deadline: null`.
2. Server broadcasts the group; `publicizeTheme` keeps `deadline: null`.
3. Client renders the Overview "Current Theme" card and the Round tab. All three deadline render sites call `new Date(null)` and display epoch-derived text.
4. Judge picks a topic → server sets a real `deadline` → the same render sites now show correct values.

Component that must change: `web-app/src/pages/GroupView.jsx` (the three render sites only). No server change: `deadline: null` during `topic_selection` is the settled design (`docs/design/a4-round-windows-change-design.md`, proposed delta #4 "display the active window"). The countdown `useEffect` (`~151`) already guards on `group?.currentTheme?.deadline` being truthy and needs no change.

## Repair requirements

- When `currentTheme.deadline` is absent or not a valid date, all three sites show a plain placeholder (for example, "Not set yet"), not an epoch date and not a negative hours value.
- When `currentTheme.deadline` is a valid instant (submission and voting phases), the displayed text is unchanged from today.
- Keep the change display-only. Do not alter when the server sets the deadline, and do not touch the countdown effect.
- Carry a focused regression: drive a group to `topic_selection` through the UI and assert the Round tab "Deadline" stat shows the placeholder and contains no "1970"/"1969"; assert the Overview "Time Remaining" stat shows no negative hours.

## Done when

- In `topic_selection`, the Round tab "Deadline" stat, the Overview "Current Theme" "Deadline" stat, and the Overview "Time Remaining" stat each show the placeholder text.
- In `submission` and `voting`, all three show the same text they show today (a real date / "N hours").
- A focused Playwright regression covers the `topic_selection` case.
- `cd web-app && npm run lint` shows no new errors (23 pre-existing warnings are the baseline).
- Full `cd web-app && npx playwright test` stays green.
