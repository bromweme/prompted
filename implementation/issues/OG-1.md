# OG-1 — Open Groups: find and join a group without an invite code

- **Status:** Implemented (Wave 13, uncommitted; no independent review yet).
- **Priority:** high
- **Guarantee:** A signed-in player can find groups that are open to anyone, read a group's page before committing, and ask to join — without knowing anybody or holding an invite code. A group is listed only while joining it is actually possible, and being listed never hands out a way in.

## Origin

User direction, not a discovery finding. Until now the only way into a group was an invite code or a `/join/<code>` link (`UI-2`), so a new player with no friends on the site had nowhere to go from the dashboard. Open Groups is the cold-start path.

## Current behavior (grounded)

**Server (`server/server.js`)**

- `isOpenGroup(group)` (`:865`) — a group is open when `group.isPrivate !== true` **and** `group.status === 'setup'`. Once a round starts, the group drops off the list and the invite code is the only way in. This is what keeps the listing from being a back door into a running game.
- `openGroupSummary(group)` (`:871`) — the only shape a non-member ever sees: `id`, `name`, `description`, `hostName`, `playerCount`, `createdAt`. Deliberately no invite code and no player ids.
- `OPEN_GROUPS_LIMIT = 48` (`:863`) caps a `get_open_groups` response.
- `get_open_groups` — returns the open list, newest first.
- `get_group_preview` — the view-only page for a non-member: the same summary plus the viewer's own `requestState` (see `JR-1`), so the page can show Request to Join, Pending, or the reason they can't.
- `notifyOpenGroupsChanged(group, { removed })` (`:888`) — called from `broadcastGroup`, it emits `open_groups_changed` to every connected socket so open lists refresh live. It compares a signature of `[name, description, playerCount]` and stays silent when that hasn't changed, so ordinary round traffic (votes, submissions) doesn't ping every socket in the app.

**Client**

- `web-app/src/hooks/useOpenGroups.js` — fetches the list, subscribes to `open_groups_changed`, and coalesces bursts (`CHANGE_COALESCE_MS = 1000`) so a room filling up doesn't refetch once per join.
- `web-app/src/pages/Dashboard.jsx:14` — `OPEN_GROUPS_PREVIEW = 12`: a 6x2 preview grid under the player's own groups, with a "View all open groups" link to `/open-groups`.
- `web-app/src/pages/OpenGroups.jsx` — the full search page: name/description search debounced at `SEARCH_DEBOUNCE_MS = 300`, `PAGE_SIZES = [12, 24, 48]` with `DEFAULT_PAGE_SIZE = 12`, and page/size kept in the query string (defaults omitted) so a search is linkable.
- `web-app/src/components/OpenGroupCard.jsx` — one card: name, host, player count, description.
- `web-app/src/components/GroupPreview.jsx` — the view-only group page a non-member lands on, with the join call to action.
- Route `/open-groups` (`App.jsx:64`).

## Affected surface

| Area | Change |
|---|---|
| `server/server.js` | `isOpenGroup`, `openGroupSummary`, `OPEN_GROUPS_LIMIT`, `notifyOpenGroupsChanged`, `get_open_groups`, `get_group_preview`. |
| `web-app/src/hooks/useOpenGroups.js` | New: fetch + live refresh + coalescing. |
| `web-app/src/pages/OpenGroups.jsx` / `.css` | New: search page with pagination and query-string state. |
| `web-app/src/components/OpenGroupCard.jsx` / `.css`, `GroupPreview.jsx` / `.css` | New: card and view-only group page. |
| `web-app/src/pages/Dashboard.jsx` / `.css` | 12-card preview section + View All link. |
| `web-app/src/App.jsx` | `/open-groups` route. |
| e2e | `open-groups.spec.js` (17, API), `open-groups-dashboard.spec.js` (8, browser). |

## Done when

- A signed-in player sees open groups on the dashboard and on `/open-groups`, with search and pagination, and both update without a refresh when a group opens, fills, or starts.
- A private group and a group whose round has started are never listed.
- No invite code and no player ids reach a non-member through any open-groups payload.
- A non-member can open a group's page read-only and ask to join from there.
- `cd web-app && npm run lint` no new errors; full Playwright suite green.

## Depends on

`UI-2` (group id split from invite code — a listed group must be identifiable without exposing the way in). Joining from a listing is `JR-1`.
