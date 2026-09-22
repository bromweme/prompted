# NT-1 — Notifications: a header bell, a full page, and per-player delivery

- **Status:** Implemented (Wave 13, uncommitted; no independent review yet).
- **Priority:** high
- **Guarantee:** A player is told what happened while they were away — their turn to judge, a round or game starting or ending, someone asking to join, a request answered, a join, a kick or ban. Notifications are kept per player on the server, reach every tab that player has open, and can be read, removed one at a time, or cleared.

## Origin

User direction. Rounds are asynchronous and run on deadlines, so a player who isn't on the page when their turn comes has no way to find out. Without this, a group stalls because nobody knew it was their move.

## Current behavior (grounded)

**Server (`server/server.js`)**

- `notificationStore` (`:52`) — a `PersistentStore` keyed by user id, newest first, so notifications survive a restart.
- `userRoom(uid)` → `user:<uid>` (`:741`): every socket a signed-in player has open joins a room named for them, and `notifyUser` (`:746`) reaches the player by identity rather than by connection. That is what makes delivery multi-tab and offline-safe.
- `MAX_NOTIFICATIONS = 100` (`:753`) caps a player's list so a busy group can't grow it forever.
- `pushNotification(uid, { type, group, text, link })` (`:759`).
- `announceGroupChanges(group)` — a snapshot diff called from `broadcastGroup`, the single choke point where group changes turn into notifications, so an event can't be announced twice by two code paths.
- Types in use: `set_started`, `game_started`, `game_finished`, `round_started`, `round_results`, `submissions_open`, `voting_open`, `your_turn_judge`, `host_changed`, `join_request`, `request_accepted`, `request_declined`, `joined`, `member_joined`, `kicked`, `banned`, `unbanned`.
- Handlers: `get_notifications`, `mark_notifications_read`, `delete_notification`, `clear_notifications`.
- Links are purposeful: a `join_request` opens the host's Requests tab (`/group/<id>?tab=requests`); an accepted request opens the group; a third decline and a ban carry no link, because there is nothing the player can open.

**Client**

- `web-app/src/hooks/useNotifications.js` — list, unread count, live updates, and `timeAgo`.
- `web-app/src/components/NotificationBell.jsx` — `PANEL_LIMIT = 3` in the dropdown, with "See all N notifications" when there are more, and Clear all behind a confirm.
- `web-app/src/components/NotificationItem.jsx` — the link carries router state `{ fromNotification }`; accessible names are "Open: `<text>`" and "Remove notification: `<text>`".
- `web-app/src/pages/Notifications.jsx` / `.css` and the `/notifications` route (`App.jsx:65`) — the full history.

## Affected surface

| Area | Change |
|---|---|
| `server/server.js` | `notificationStore`, `userRoom`/`notifyUser`, `pushNotification`, `announceGroupChanges`, four handlers, notification sites across the round and moderation flows. |
| `web-app/src/hooks/useNotifications.js`, `components/NotificationBell.jsx` / `.css`, `components/NotificationItem.jsx` | New. |
| `web-app/src/pages/Notifications.jsx` / `.css`, `src/App.jsx`, `components/AppNav.jsx` | New page, route, and the bell in the header. |
| e2e | `game-rules.spec.js` notification describe (API), `game-ui.spec.js` (browser). |

## Done when

- Every listed event reaches the right players and nobody else; the Judge's identity is never leaked by a notification before the reveal.
- Notifications survive a restart and reach every open tab of the same player.
- The panel shows at most 3 with a link to the full page; items can be removed individually and cleared together.
- A notification's link lands on the thing it's about.
- Full Playwright suite green; lint no new errors.

## Depends on

`JR-1` (moderation events), `GS-1` (set start/finish events).
