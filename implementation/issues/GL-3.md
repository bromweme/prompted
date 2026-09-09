# GL-3 — Neutralize the dead Dashboard tabs and Quick Actions

- **Status:** Done
- **Priority:** medium
- **Depends on:** none
- **Source finding:** `f.ui-dead` (deep-discovery)
- **Owner:** `web-app/src/pages/Dashboard.jsx` and `web-app/src/pages/Dashboard.css` (single worker)
- **Wave result:** Implemented in Wave 1. Dead tab strip replaced with a single non-interactive "Active" label; Quick Actions cards removed. `group-layout` + `accessibility` specs pass.
- **Review:** Initial review (review-work) found no defects in either ordinary or adversarial pass.

## What is broken

Two controls on the Dashboard read as actionable but do nothing:

1. **Tab bar (Active / Completed / Archived).** It renders as a tab strip (`Dashboard.jsx:166-168`) but no tab filters the group list; clicking a tab does nothing. It is duplicated in the empty-state section (`:243-246`).
2. **Quick Actions cards (Browse Groups / Invite Friends / View Stats / Settings).** They render as clickable cards (`Dashboard.jsx:265-284`) but have no `onClick` handler.

## Intended behavior

Choose the behavior that is simplest and honest: **make non-functional controls non-interactive** rather than wiring them to nonexistent features.

- The Active / Completed / Archived tabs: render as plain status labels (or a single "Active" label matching the real filter), with no clickable behavior. Do not imply filtering that does not happen.
- Quick Actions: either remove them or render them as non-interactive cards (no `onClick`, no button/card affordance that implies navigation). Do not leave clickable elements with no handler.

Keep the change small and confined to the Dashboard. Do not add new routes, features, or persistence.

## Done conditions

- [ ] No Dashboard element implies an action that does nothing: no tab press changes or appears interactive without filtering, and no Quick Action card shows a button/cursor affordance with no handler.
- [ ] The rendered group list is unchanged (still shows the player's groups, still filters by none / by active state exactly as before).
- [ ] `web-app/e2e/group-layout.spec.js` and `web-app/e2e/accessibility.spec.js` still pass.
- [ ] No server behavior changes; no new routes.

## Repository checks

- `cd web-app && npx playwright test --project=chromium` (group-layout and accessibility must pass).
- `cd web-app && npm run lint` (oxlint; no new errors).
- Do not edit `implementation-queue.md` or any `issues/*.md`; do not commit; do not push.