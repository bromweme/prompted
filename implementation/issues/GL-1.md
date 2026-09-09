# GL-1 — Implement real Leave Group and Delete Group

- **Status:** Implemented
- **Priority:** high
- **Depends on:** none
- **Blocker(s):** `REP-GL1-1`, `REP-GL1-2` (filed by review-work initial review)
- **Source finding:** `f.leave`, `f.ui-dead` (deep-discovery)
- **Repair scope:** server engine + GroupView client + e2e. This is a cross-component repair; the server event contract and the client wiring are both required and are owned by different assignments in one wave (server = issue-worker A, client = issue-worker B).
- **Wave result:** Implemented in Wave 1. Server `leave_group`/`delete_group` handlers and client wiring merged; `leave-delete.spec.js` proves the server contract. Full chromium suite 70/70 green; oxlint 0 errors. Review-work initial review found no blocking defect in delivered behavior but filed two repairs before marking `Done` (host-leave orphan robustness; missing browser-navigation test coverage).

## What is broken

Both controls exist in the Group View (Leave Group and Delete Group) but do nothing. They confirm with the user and then only call `navigate('/dashboard')`. No `leave_group` or `delete_group` event is sent, and the server has no handler for either. A player who "leaves" is still a member. A host who "deletes" still owns the group.

Current dead code:

- `web-app/src/pages/GroupView.jsx:1636-1655` — Delete Group and Leave Group both confirm then navigate.
- `web-app/src/pages/GroupView.jsx:1132-1147` (`handleLeaveGroup`) — only navigates.
- No `leave_group` / `delete_group` handler exists in `server/server.js`.

## Intended behavior

### Leave Group (any member)

1. The server removes the caller from `group.players`.
2. The caller's client navigates to `/dashboard`.
3. The group continues to exist for the remaining members.
4. Everyone still in the group receives an updated player roster.
5. The caller may join again later.

### Delete Group (host only)

1. Only the host may delete the group. Any other caller gets an error.
2. The server permanently removes the group (use `groups.delete(id)` — `PersistentStore.delete` exists at `server/db.js:41-43`).
3. The host's client navigates to `/dashboard`.
4. Remaining connected members are told the group is gone and their clients return to `/dashboard`.

## Done conditions

- [ ] `deleting` / `leaving` state disables both buttons while a request is in flight.
- [ ] `server/server.js` registers `leave_group` and `delete_group` handlers using the same `on(...)` wrapper and identity pattern as the other handlers (read identity from `socket.data.userId`, never from the payload).
- [ ] `leave_group` removes the caller from `group.players`, persists via `groups.set`, and rebroadcasts the group so remaining members see the updated roster. It is a no-op (not an error) if the caller is already not a member.
- [ ] `delete_group` rejects any caller who is not `group.host` with a clear error and no state change. On success it calls `groups.delete(gid)` and notifies the still-connected members (a `group_deleted` event) so their clients can navigate away.
- [ ] The client's Leave Group and Delete Group buttons emit `leave_group` / `delete_group` with the group id, and on `group_deleted` the client navigates to `/dashboard`.
- [ ] A new e2e spec `web-app/e2e/leave-delete.spec.js` proves: (1) a member leaves and the remaining host sees them removed; (2) only the host can delete (a non-host delete is refused); (3) after a host deletes, connected members are returned to the dashboard; (4) a socket-based (`raw`) member removal also works, matching the assertion style of `round-phases.spec.js`.
- [ ] A player who left can rejoin the group.
- [ ] The dead `handleLeaveGroup` only-navigates path is gone.

## Cross-issue seams and integration order

- The event names and payloads (`leave_group { groupId }`, `delete_group { groupId }`, outbound `group_deleted`) are the cross-component contract between worker A (server, `server.js`) and worker B (client, `GroupView.jsx`).
- Worker A implements the server contract and the e2e spec; worker B implements the client wiring against the same contract. The wave lead validates the integrated flow end to end after both are merged.

## Ownership

- **Worker A (server):** `server/server.js`, `web-app/e2e/leave-delete.spec.js`.
- **Worker B (client):** `web-app/src/pages/GroupView.jsx` (and any new component it needs for the leave/delete UI), following the event contract above.
- No other assignment may touch `server/server.js`, `GroupView.jsx`, or `leave-delete.spec.js` in this wave.

## Checks to run

Worker A runs the new `leave-delete.spec.js` plus `round-phases.spec.js` (server/UI parity). Worker B runs `round-phases.spec.js` and `group-layout.spec.js`. The lead runs the full `web-app` e2e suite for the final integration.

## Repository checks

- `cd web-app && npx playwright test --project=chromium` (must pass, including the new spec).
- `cd web-app && npm run lint` (oxlint; no new errors).
- Do not edit `implementation-queue.md` or any `issues/*.md`; do not commit; do not push.