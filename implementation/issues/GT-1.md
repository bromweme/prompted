# GT-1 — Host-supplied topic list when custom topics are off, and one play per topic per set

- **Status:** Implemented (Wave 13, uncommitted; no independent review yet).
- **Priority:** high
- **Guarantee:** With `allowCustomTopics` off, the group plays from a list the host writes, and the game can't be started or stripped below one unused topic per remaining round. In every group, a topic plays at most once per set; a new set frees them all again.

## Origin

User direction. `allowCustomTopics: false` existed as a setting but left the Judge with nothing to pick from, so a group with it off could not play. The host needs to supply the topics, and the app has to guarantee there are enough of them before a round starts rather than stalling mid-game.

## Current behavior (grounded)

**Server (`server/server.js`)**

- `usesHostTopics(group)` (`:655`) — `settings.allowCustomTopics === false`.
- `topicsForGroup(group, viewerUserId)` (`:577`) — when the host's list is in use, the Judge sees only that list, minus anything already played this set.
- `unusedHostTopicCount(group)` (`:659`) — the list minus `usedTopicIds`; this is the number checked against `roundsRemaining(group)` before a round starts.
- `MAX_HOST_TOPICS = 100` (`:643`).
- `add_group_topic` (`:1595`) and `remove_group_topic` (`:1622`), both host-only. Removal is refused for a topic already played this set ("A topic that's been played this game can't be removed until the game ends"), and, mid-game with the host's list in use, refused when it would drop the unused count below the rounds left ("This game still needs N unused topics for the rounds left"). So a host can't hollow out a running game.
- **One play per set:** `select_topic` (`:1186`) refuses a topic in `usedTopicIds` ("That topic has already been played in this game") and records it on selection (`:1206`). `start_new_set` clears the list (`GS-1`).

**Client**

- `web-app/src/components/HostTopicEditor.jsx` — the shared editor, used both in the group's Topics tab and inside the "Add your topics to start" modal (`UX-1`), so both validate identically. It mirrors the server's limits (300 characters, 100 topics) and rejects an empty topic, an over-long one, a case-insensitive duplicate, and an add attempted while disconnected. An add is confirmed by the topic appearing in the group; after `CONFIRM_TIMEOUT_MS = 8000` with no confirmation it says so rather than hanging. Progress reads "N of M added" with a progress bar; a played topic's Remove button is disabled and says why in its accessible name.

## Affected surface

| Area | Change |
|---|---|
| `server/server.js` | `usesHostTopics`, `unusedHostTopicCount`, `MAX_HOST_TOPICS`, `topicsForGroup` branch, `add_group_topic`, `remove_group_topic`, `select_topic` reuse guard and `usedTopicIds` bookkeeping. |
| `web-app/src/components/HostTopicEditor.jsx` / `.css` | New: shared, validated editor. |
| `web-app/src/pages/GroupView.jsx` / `.css` | Topics tab hosts the editor; the start flow uses it in a modal (`UX-1`). |
| `web-app/src/pages/CreateGroup.jsx` | Allow Custom Topics sits in Game Settings; the "Judge picks the topic" copy was removed. |
| e2e | `game-ui.spec.js` (16, browser), `game-rules.spec.js` (16, API). |

## Done when

- A group with custom topics off plays from the host's list and never offers the Judge a topic that has already been played this set.
- A round can't start with fewer unused topics than rounds remaining, and a mid-game removal can't take it below that line.
- The same validation applies wherever the editor is shown.
- Full Playwright suite green; lint no new errors.

## Depends on

`GS-1` (a set is what "already played" is scoped to). The start-time modal is `UX-1`.
