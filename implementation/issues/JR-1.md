# JR-1 — Join requests, decline limit, kicks and bans

- **Status:** Implemented (Wave 13, uncommitted; no independent review yet).
- **Priority:** high
- **Guarantee:** A stranger who finds a group through Open Groups asks to join, and the host decides. A host can remove someone who is already in, and can shut out someone for good. Nobody new joins in the middle of a round, and a host's moderation state is never visible to the other players.

## Origin

User direction, paired with `OG-1`: once anyone can find a group, the host needs a gate and a way to remove people. Three declines was the user's call — a stranger can't pester a host indefinitely.

## Current behavior (grounded)

**The gate (`server/server.js`)**

- `DECLINE_LIMIT = 3` (`:705`).
- `isRoundInProgress(group)` (`:697`) — true when `status === 'active'` and a `currentTheme` exists whose status isn't `reveal`. Nobody new joins while that holds, by request **or** by invite code. Before the first round and between rounds (after a reveal) is fine. Reconnecting members are unaffected: the gate only covers adding a new member.
- `isBanned(group, uid)` (`:701`) — checks `group.bannedUsers`.
- `joinRefusal(group, uid)` (`:714`) — the single place that says why someone can't come in: `banned` → "You have been banned from this group. Think about what you've done.", or `round_in_progress` → "This group is in the middle of a round. You can join once it ends." Every join path calls it, so the rules can't drift between the invite path and the request path.
- `requestStateFor(group, uid)` (`:720`) — the asker's own view: `member`, `banned`, `pending`, `blocked` (at the decline limit), or `none`, plus `declinesLeft`.
- `hostPanelFor(group, viewerUserId)` (`:734`) — requests and bans, host only. `publicizeGroup` (`:214`) deletes `joinRequests` and the ban fields from the group every other player receives, so moderation state never rides along in a broadcast.

**Handlers:** `request_join` (`:1681`), `cancel_join_request` (`:1717`), `respond_join_request` (`:1730`), `kick_player` (`:1806`), `ban_player` (`:1837`), `unban_player` (`:1876`).

- Kick and ban differ on the way back: kicked says "You were kicked from `<group>`. You can ask to join again."; banned says "You were banned from `<group>`." with no link, and every route in is refused until `unban_player`. Unban restores the ability to ask.
- A decline tells the asker how many tries are left; at the third, the notification carries no link because there is nothing left to open.

**Client**

- `web-app/src/pages/GroupView.jsx` — the host's Requests tab (accept/decline), the members list with kick/ban, and the banned list with unban. Join-request notifications deep-link to `?tab=requests` (`NT-1`).
- `web-app/src/components/GroupPreview.jsx` — the non-member's Request to Join / Pending / refusal states, driven by `requestState`.

## Affected surface

| Area | Change |
|---|---|
| `server/server.js` | `DECLINE_LIMIT`, `isRoundInProgress`, `isBanned`, `joinRefusal`, `requestStateFor`, `hostPanelFor`, six handlers, `publicizeGroup` strip. |
| `web-app/src/pages/GroupView.jsx` / `.css` | Requests tab, kick/ban controls, banned list, `?tab=requests` deep link. |
| `web-app/src/components/GroupPreview.jsx` | Asker-side states. |
| e2e | `join-requests.spec.js` (21, API), `join-requests-ui.spec.js` (6, browser). |

## Done when

- A non-member can ask, cancel, and be accepted or declined; three declines and that group refuses further asks.
- A host can kick (they may return) and ban (every way in refused, including the invite code) and unban.
- No new member is added while a round is under way, by any path.
- `joinRequests` and `bannedUsers` never reach a non-host client.
- Full Playwright suite green; lint no new errors.

## Depends on

`OG-1` (the discovery path that makes requests necessary), `UI-2` (membership gate on group-scoped handlers).
