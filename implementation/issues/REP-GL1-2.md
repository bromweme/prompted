# REP-GL1-2 — No e2e test proves the client navigates on `left_group` / `group_deleted`

- **Status:** Ready (repair, filed by review-work initial review)
- **Priority:** medium
- **Source issue:** GL-1
- **Blocks:** `GL-1`
- **Depends on:** none
- **Guarantee to restore:** GL-1's done condition "the client navigates to /dashboard on group_deleted / left_group" must be demonstrated by a test. Right now the implementation is correct by inspection, but no test would fail if the client wiring were removed.

## Failed behavior (coverage gap, not a runtime bug)

`web-app/e2e/leave-delete.spec.js` drives every leave/delete actor through **raw sockets** (`connect()` + emits), in the `round-phases.spec.js` style. The only browser page in the whole spec is test 1's host, and it only *observes* a roster drop via `group_updated` (an assertion like `getByText('1 player')`). Specifically:

- Test 1: a raw-socket leaver leaves; the host *browser page* sees the roster drop. Nothing clicks the actual Leave button.
- Tests 2–5: driven entirely by raw sockets.
- No test ever clicks the real Leave Group or Delete Group button, and no test asserts that a page navigates to `/dashboard` after `left_group` or `group_deleted`.

Consequence: every test in the spec would still pass if `GroupView.jsx`'s client wiring — `handleLeaveGroup`/`handleDeleteGroup` emits, the `left_group`/`group_deleted` setup-effect listeners, and their `navigate('/dashboard')` — were broken or removed. GL-1's client-navigation done condition is therefore unproven by the test suite.

## Affected flow

1. A member (host or non-host) clicks Leave Group or Delete Group in the real Group View.
2. The client emits `leave_group` / `delete_group` and listens for `left_group` / `group_deleted`.
3. On those replies the client calls `navigate('/dashboard')`.
4. No current test exercises steps 1–3 through the browser, so a regression in any of them would go uncaught.

Current artifacts: `web-app/e2e/leave-delete.spec.js`, `web-app/src/pages/GroupView.jsx` (handlers at ~:389–446, listeners at ~:277–295).

## Repair requirements

- Add a browser-page e2e test that drives the actual UI controls (click the Delete Group button and, for a non-host member, the Leave Group button) and asserts the page navigates to `/dashboard` on the server reply.
- The test must fail if the client wiring is removed, and must pass against the current implementation.
- Reuse the suite's existing helpers and authentication (the same patterns `leave-delete.spec.js` and `round-phases.spec.js` use). Do not change the server contract or the implementation to make the test pass.

## Done when

- A new case in `web-app/e2e/leave-delete.spec.js` opens a real browser user in the group, clicks the real Leave Group (non-host) button, and asserts navigation to `/dashboard`.
- A case clicks the real Delete Group (host) button and asserts navigation to `/dashboard`.
- The case would fail if the `left_group`/`group_deleted` → `navigate` wiring were removed (the reviewer verified this by inspection of the current empty client-path coverage).
- The full chromium e2e suite stays green.

## Depends on

None.