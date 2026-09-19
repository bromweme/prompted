# REP-UI2-1 — Legacy `?join=true` member locked out after an invite-code reset (UI-2 repair)

- **Status:** Done (Wave 12 repair, `54f818e`; closure review passed).
- **Priority:** high (blocks `UI-2`)
- **Found by:** Wave 12 initial review — change-reviewer (BLOCKING), independently confirmed by the adversarial reviewer.
- **Guarantee (from UI-2):** "The host can reset the invite code; the old code stops working immediately and **existing members are unaffected**."

## Defect

A player joins a **legacy** group (id `GROUP…`, no `inviteCode`) through `/group/<id>?join=true`. `GroupView.jsx` (~305-328) emits `join_group { inviteCode: <id>, via: 'link' }` and never removes `?join=true` from the URL. After the host resets the code (`reset_invite_code` retires the legacy id from the index, `server.js` ~1634-1637), any reload, socket reconnect (`isConnected` flips, the load effect re-runs — deps at `GroupView.jsx:381`), or reopened bookmark re-sends the join with the retired id:

- the server answers "Invite code not found" before any membership check and records a throttle failure (`server.js` ~1092-1098);
- the client's `onLoadError` sets `accessError` and replaces the page with "Couldn't join this group" (`GroupView.jsx` ~311-314, 777-801);
- repeated reloads can trip the 10-failures/60s throttle and block the user's legitimate joins for a minute.

The user is still a member — the Dashboard card (`get_group`) works — but the page they were on is broken.

## Fix (required)

1. **A member never needs to join.** On `/group/:id?join=true`, load the group with `get_group` first. If it succeeds (the caller is a member), render it and do **not** emit `join_group`. Only if `get_group` answers "Group not found" fall back to `join_group { inviteCode: <id>, via: 'link' }` (the legacy alias for a genuine newcomer).
2. **Strip the query after a successful join** — `navigate('/group/<id>', { replace: true })` (or equivalent) once `group_joined` arrives, so later reloads/reconnects take the plain member path.
3. Keep the new-style flows unchanged: `/join/<code>`, Dashboard join, the not-a-member page for a real non-member, `get_group` gate.

## Also fix (reviewer observation, same component)

4. **Reset button can stick on "Resetting…"** (`GroupView.jsx` ~625-650, ~186-190): if the socket drops between `reset_invite_code` and its reply, `resettingCode` stays `true` (the reply/error listeners are gone). Clear `resettingCode` (and the confirm step) on disconnect / when the modal closes, so the host can retry. A successful reset still arrives via `group_updated`.

## Tests

- Extend the legacy test in `e2e/invite-code.spec.js`: after the member joins via `?join=true` **and the host resets**, reload the member's page (and ideally force a socket reconnect) → the member still sees the group (e.g. "Leave Group" visible), no access-error page, and the URL no longer contains `join=true`. Prove it red against the pre-repair code.
- Assert that a member opening a bookmarked `/group/<legacyId>?join=true` after a reset still sees the group, and that no `invite_opened` `not_found` row / throttle failure is recorded for them (or at least that repeated reloads do not produce the throttle message).
- A genuine non-member opening `/group/<legacyId>?join=true` after a reset still gets the not-a-member / not-found page.

## Done when

- The scenario above no longer shows the error page or records throttle failures for a member.
- `?join=true` is removed from the URL after a successful legacy join.
- The reset button recovers after a dropped connection.
- `cd server && npm test`, `cd web-app && npm run lint` (0 errors / 23 baseline), full `cd web-app && npx playwright test` green.

## Depends on

`UI-2` (`d94de54`).
