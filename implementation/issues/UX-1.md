# UX-1 — Start-flow dead ends: a clickable Start, connection feedback, and wizard validation

- **Status:** Implemented (Wave 13, uncommitted; no independent review yet).
- **Priority:** medium
- **Guarantee:** No primary action in the app is greyed out with the reason left unsaid. Clicking Start Round always does something: it starts the round, or it opens a modal that says what's missing and fixes it in place. The app says when it can't reach the server, and the Create Group wizard says why it won't advance.

## Observed

User, on the group page with custom topics off: the "Topics: 0 of 4 needed (one per round). Add topics" line "doesn't pop out to me on the page — worried it's going to confuse people and they won't play". The Start Round button was disabled, so the one thing a host would click did nothing and the explanation sat in text they hadn't noticed. A read-through of the rest of the app for the same trap found two more: a disabled wizard **Next** with no message, and no feedback at all while the socket is down — which is the normal first experience on a host that sleeps when idle, where the first load can take up to a minute.

## Current behavior (grounded)

**`web-app/src/pages/GroupView.jsx`**

- `MIN_PLAYERS_TO_START = 2` (`:762`), mirroring the server. A round is a Judge plus at least one submitter.
- `openStartFlow()` (`:508`) — the single entry point both Start Group and Start Round now call:
  - fewer than `MIN_PLAYERS_TO_START` players → the "Invite someone to start" modal, which explains and opens the existing Invite modal, and mentions Open Groups when the group is public and still in setup;
  - status `setup` and not enough unused topics → the "Add your topics to start" modal, which embeds `HostTopicEditor` (`GT-1`) so the host adds them without leaving the flow; its Start round button stays disabled with a count until there are enough, then opens the Judge prompt;
  - otherwise → the Judge prompt, as before.
- The Start buttons are no longer disabled.
- The setup checklist shows the players warning only when the group has exactly one player (the user's call: with 2+ players it's noise, and the topics case is covered by the modal).

**`web-app/src/components/ConnectionBanner.jsx`** — appears after `SHOW_AFTER_MS = 1500` of being disconnected, so a page load or a quick reconnect doesn't flash a warning, and says the server may take up to a minute to wake. It lives in a persistent `role="status"` region mounted in `App.jsx`, so it is announced without stealing focus.

**`web-app/src/pages/CreateGroup.jsx`** — Next and Create Group are always clickable; without a name they show an inline `role="alert"` error ("Enter a group name to continue."), mark the input `aria-invalid`, and move focus to it.

## Affected surface

| Area | Change |
|---|---|
| `web-app/src/pages/GroupView.jsx` / `.css` | `openStartFlow`, two modals, `.setup-warning` at one player only, start buttons enabled. |
| `web-app/src/components/ConnectionBanner.jsx` / `.css`, `src/App.jsx` | New: connection feedback. |
| `web-app/src/pages/CreateGroup.jsx` / `.css` | Inline name validation, buttons enabled. |
| e2e | `game-ui.spec.js` "starting a game with something missing" and the wizard test; `accessibility.spec.js` covers both modals; `round-phases.spec.js` solo test now expects the modal. |

## Done when

- Start Round is never disabled; every reason it can't start is reachable by clicking it and fixable there.
- The players warning shows only at one player.
- A disconnected app says so within a couple of seconds, without covering the page.
- The wizard says why it won't advance and puts focus on the field to fix.
- Both new modals pass axe WCAG 2.1 AA and trap/restore focus via `useModalA11y`.
- Full Playwright suite green; lint no new errors.

## Not in scope (tracked as a note)

27 native `alert()` calls remain (`GroupView.jsx` 22, `CreateGroup.jsx` 2, `Dashboard.jsx` 2, `Account.jsx` 1). They block the page, can't be styled, and read poorly on mobile. Replacing them with in-page messages is its own pass — see the note in `implementation-queue.md`.

## Depends on

`GT-1` (the editor the topics modal embeds).
