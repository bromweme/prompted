# GS-1 — A game is a set of `totalRounds` rounds, and it ends

- **Status:** Implemented (Wave 13, uncommitted; no independent review yet).
- **Priority:** high
- **Guarantee:** `totalRounds` is a real limit, not a label. After the last round resolves, the group finishes with final standings and starts no further rounds until the host begins a new set. A new set resets the round counter, the played-topic list and the Judge cycle, and keeps the finished set's standings.

## Origin

Closes the long-standing out-of-scope note in `implementation-queue.md`: "`maxPlayers` / `totalRounds` are displayed as limits but never enforced ... needs a product decision first." The user made the decision — a group plays a fixed number of rounds, ends, and can start again — so `totalRounds` is now enforced. `maxPlayers` is still not enforced and stays an open note.

## Current behavior (grounded)

**Server (`server/server.js`)**

- `DEFAULT_TOTAL_ROUNDS = 6`, `MAX_TOTAL_ROUNDS = 50` (`:641`), `clampTotalRounds` (`:645`) floors, bounds to 1–50 and falls back to the default for anything non-finite; `totalRoundsOf(group)` (`:651`) reads settings through it, so a stored bad value can't produce an endless or zero-round game.
- `roundsRemaining(group)` (`:665`) — rounds in this set that haven't started.
- `finishSet(group)` (`:671`) — after the last round resolves: sorts players by score into `finalStandings`, sets `status = 'finished'`, appends `{ set, rounds, endedAt, standings }` to `completedSets`, and logs a `game_finished` event.
- Called at round resolution (`:1010`) when `currentRound >= totalRoundsOf(group)`.
- `start_new_set` (`:1568`) — host only, and only from `finished`. Resets `status` to `setup`, `currentRound` to 0, clears `currentTheme`, `usedTopicIds`, `finalStandings` and `judgedThisCycle`, and increments `setNumber`. Logs `set_started`.
- New groups are created with `usedTopicIds: []` and `setNumber: 1` (`:1347`).

**Client:** `web-app/src/pages/GroupView.jsx` shows final standings when the group is `finished`, with a host-only "Start a new game" action; the start controls for a new round are not offered in that state.

**Notifications:** `game_finished` and `set_started` notification types (`NT-1`).

## Affected surface

| Area | Change |
|---|---|
| `server/server.js` | `clampTotalRounds`, `totalRoundsOf`, `roundsRemaining`, `finishSet`, the resolution-time call, `start_new_set`, new-group fields. |
| `web-app/src/pages/GroupView.jsx` / `.css` | Finished state, final standings, "Start a new game". |
| e2e | `game-rules.spec.js` (16, API) covers the end of a set and the reset; full games at every size 3–8 in the browser suite check that a set ends where it should. |

## Done when

- A group that reaches `totalRounds` finishes, keeps final standings, and starts no further round on its own.
- Only the host can start a new set, and only from `finished`; the new set starts at round 0 with topics and the Judge cycle freed.
- A stored `totalRounds` outside 1–50, or a non-number, can't produce an endless or zero-round game.
- Full Playwright suite green; lint no new errors.

## Depends on

`RT-3` (Judge rotation — `judgedThisCycle` is reset per set). Topic reuse within a set is `GT-1`.
