# UI-3 — "Start Group" button: rename to "Start Round" and use the active (primary) style

- **Status:** In progress (Wave 10). Small, JSX + CSS-class only, no product decision needed.
- **Priority:** low
- **Guarantee:** On the host's Group Setup panel, the call-to-action reads "Start Round" and looks like an enabled primary action when the group can start.

## Observed

Group Setup panel (host, `group.status === 'setup'`), screenshot from the user: "Players joined: 2 / Ready to start", but the "Start Group" button renders as a muted grey outline — it reads as disabled even though it is enabled.

## Current behavior (grounded)

`web-app/src/pages/GroupView.jsx:807-815`:

```jsx
<button
  className="setup-button secondary"
  onClick={handleStartGroup}
  disabled={!canStartRound}
>
  Start Group
</button>
```

- `.setup-button.secondary` (`web-app/src/index.css:189-199`) is the outline/neutral style: `background: var(--color-bg)`, `border-color`/`color: var(--color-text-secondary)`. The Group Setup panel sits on `--color-bg`, so this is grey text + grey border on the same grey ground — it looks inactive.
- The equivalent "Start Next Round" button between rounds (`GroupView.jsx:1331`) already uses `className="setup-button primary"` (solid accent, white text).
- The label "Start Group" is inconsistent with "Start Round" (`GroupView.jsx:905`) and "Start Next Round" (`:1335`) used elsewhere for the same action. The button opens the Select-Judge prompt and begins round 1 (`handleStartGroup`, `GroupView.jsx:409`).

## Requested outcome

1. Button text: "Start Group" -> "Start Round".
2. Button style: use the primary (solid accent) look so an enabled button reads as active. The existing `:disabled` rule (`index.css:255-260`, `opacity: 0.5`) still makes the sub-two-players state clearly inactive.

## Affected surface

| Area | Change |
|---|---|
| `web-app/src/pages/GroupView.jsx` | Line ~809 `secondary` -> `primary`; line ~813 text -> "Start Round". Update the nearby explanatory comments that say "Start Group" (`:798`, `:409`) for accuracy. |
| e2e | Exact-text selectors must change to "Start Round": `modals.spec.js:92,119`; `round-phases.spec.js:100,183`; `video-titles.spec.js:48,102`; `visibility.spec.js:99`. `helpers.js:88` regex already accepts "Start Round" — no change. Update the cosmetic "Start Group" mentions in comments (`modals.spec.js:84`, `visibility.spec.js:59`). |

## Done when

- The host Group Setup panel button reads "Start Round" and uses `setup-button primary`.
- With fewer than `MIN_PLAYERS_TO_START` (2) players it is visibly disabled; with 2+ it looks like an active primary button.
- All e2e specs that click the button by exact text are updated and pass.
- `cd web-app && npm run lint` no new errors (23 baseline warnings).
- Full `cd web-app && npx playwright test` green.

## Depends on

None.
