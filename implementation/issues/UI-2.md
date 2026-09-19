# UI-2 — Group code is a guessable timestamp; shareable link is long and unpolished

- **Status:** Done (Wave 12 `d94de54` + repair `REP-UI2-1` `54f818e`; closure review passed). Product decisions made 2026-09-17 (see "Decisions (confirmed)").
- **Priority:** medium (has a real security component)
- **Guarantee:** A group's join code must be an unguessable random string, and the shareable invite link must be short and clean.

## Observed

Invite Players modal (`GroupView.jsx` ~2195-2225):

- **Group Code:** `GROUP1789077058154_1` — the literal group id.
- **Shareable Link:** `localhost:5173/group/GROUP1789077058154_1?join=true`

## Current behavior (grounded)

- `server/server.js:86-89` `uniqueId('GROUP')` → `` `GROUP${Date.now()}_${idCounter}` ``. The value is the group's primary key in the `groups` SQLite store **and** the only join secret.
- `server/server.js:917-924` deliberately generates the id server-side (a prior fix: a client-supplied id let a shared link overwrite / seize a group). The comment states plainly: "ids double as the invite code".
- `web-app/src/pages/Dashboard.jsx:137` upper-cases the typed code before lookup: `joinCode.trim().toUpperCase()`. So codes are effectively case-insensitive on the "Join Group" path.
- `web-app/src/pages/GroupView.jsx:576` builds the link as `` `${window.location.origin}/group/${groupId}?join=true` ``.
- `web-app/src/pages/GroupView.jsx:272-289` auto-joins when `?join=true` is present on `/group/:groupId`.
- `server/server.js:78-80` `cleanId` only trims and length-caps (`LIMITS.id`); the id is an opaque store key with no format validation, so changing the generator does not affect lookups or stored groups.

## Why this matters

`Date.now()` plus a small incrementing counter is **predictable**. Anyone can construct `GROUP<recent-timestamp>_<small int>` and try to join. Because the id is also the invite code and joining is keyed on the id alone (`GroupView.jsx:571-575` notes there is no per-invite check), a guessed code is a working join — including into private groups. A random code closes that.

## Requested outcome (from the user)

1. Group code becomes a **randomly generated string of letters**, long enough to be secure.
2. Shareable link is **more professional and shorter** ("minified if possible").

## Recommendation (to confirm)

**Code generation.** Use a CSPRNG (`crypto.randomBytes` / `crypto.randomInt`), not `Math.random()`. Proposed: alphabet `A-Z` (26), length **20**, giving ~94 bits of entropy — far past brute-force range for a rate-limited join endpoint, and still all letters as asked. Shorter is defensible: 16 letters ≈ 75 bits. Keep the `Dashboard` case-insensitive behaviour (generate upper-case, keep the `.toUpperCase()`), or switch both sides to exact-match. Display the code grouped for readability (`XXXXX-XXXXX-XXXXX-XXXXX`), strip separators and upper-case before compare.

  - Adding digits (Crockford base32, minus confusable `I L O U`) would let the code be ~14 chars for the same entropy, but the user asked for letters.
  - Keep the id and the invite code **unified** (as today) for the minimal change. Splitting them (opaque internal id + a rotatable/revocable invite code) is a larger, separate enhancement.

**Shareable link.** Add a dedicated route `web-app/src/App.jsx` `/join/:code` that resolves the code, auto-joins, and redirects to `/group/:groupId` — so the link is `origin/join/<CODE>` with no `?join=true` query tail. Combined with a shorter code this is materially cleaner. A true URL shortener (short domain, hashed redirect key, click storage) is a separate service and out of scope here unless product wants it.

## Affected surface

| Area | Change |
|---|---|
| `server/server.js` | Replace `uniqueId('GROUP')` for groups with a CSPRNG code generator; keep server-side-only generation; ensure `join_group` / `get_group` compare consistently with the client's normalisation. Consider a light rate-limit / lockout on repeated failed `join_group` from one socket/user. |
| `web-app/src/pages/GroupView.jsx` | Show the grouped/formatted code; build the link as `origin/join/<code>`. |
| `web-app/src/pages/Dashboard.jsx` | Normalise the typed code (strip separators, case) to match the server. |
| `web-app/src/App.jsx` | New `/join/:code` route that auto-joins then redirects; keep `/group/:groupId` working, and optionally keep `?join=true` as a legacy alias for one release. |
| e2e | Update any test that hard-codes the `GROUP…` id shape or the `?join=true` link; add coverage for the new code format and the `/join/:code` flow. |
| Migration | None for storage — existing `GROUP…_n` ids stay valid keys and keep working. Only newly created groups get the new format. Existing shared `?join=true` links keep working if the legacy alias is kept. |

## Decisions (confirmed by the user, 2026-09-17)

1. **Code format:** CSPRNG, alphabet `A-Z`, length **20** (~94 bits). Displayed grouped `XXXXX-XXXXX-XXXXX-XXXXX`; input is normalised (upper-case, strip spaces/dashes) on both client and server.
2. **Link scheme:** clean `origin/join/<CODE>` path (no query tail). No short-link service. `/group/:id?join=true` stays working as a legacy alias.
3. **Split id and invite code** (the larger option). Details below.

## Design for the split (follows from decision 3)

- **Internal group id:** opaque and unguessable too (e.g. `crypto.randomUUID()`), never used as a join secret. Existing `GROUP…_n` ids stay valid keys — no storage migration of ids.
- **Invite code:** new `group.inviteCode` field (20 letters). The server keeps an in-memory `inviteCode -> groupId` index, built at startup from the groups store and updated on create / reset / delete.
- **Legacy groups** (no `inviteCode`): treated as if their invite code is their existing id, so old codes and old `?join=true` links keep working until the host resets the code. (A reset gives them a new random code and retires the legacy one.)
- **Joining is by code only.** `join_group` takes `{ inviteCode }` (normalised); an unknown code gets the generic "Invite code not found" error. Add a light per-socket/user throttle on failed attempts. A current member re-joining by code is a reconnect, as today.
- **Access by id now requires membership.** Because the id is no longer the secret, `get_group` (and any other handler that returns group data or acts on a group by id) must refuse non-members with a generic error and leak nothing. Audit every `on(...)` handler that takes `groupId` (`server.js` ~766-2000) for a membership check; most already have one.
- **Rotate / revoke:** host-only `reset_invite_code` handler that issues a fresh code, invalidating the old one (existing members are unaffected). The Invite modal gets a host-only "Reset code" button (with a confirm step that is not a native `confirm()` dialog).
- **Who sees the code:** only members receive `inviteCode` in the group payload (`publicizeGroup` is only sent to members once the membership gate is in place).
- **Client:**
  - `/join/:code` route (`App.jsx`): emits `join_group` with the code, then `navigate('/group/<id>', { replace: true })` on `group_joined`; shows a clear error for a bad code. Must work when signed out (log in, then resume the join).
  - Dashboard "Join Group" sends the normalised code, not an id.
  - `GroupView` Invite modal shows the grouped code and the `/join/<code>` link; `?join=true` on `/group/:id` stays as a legacy alias (it joins using the id as the code, which only matches legacy groups).
  - A non-member opening `/group/:id` sees a "you're not a member of this group" state instead of the group.
- **EVT-1:** if `EVT-1` has landed, log `invite_opened` from the `/join` path (server side, on a join attempt by code) and `invite_code_reset`; no code values in props.

## Implementation notes (Wave 12)

- **Throttle:** 10 failed joins per rolling 60 s per authenticated user, in memory (`server/invites.js`). Checked before the code lookup, so a throttled user is refused even with a valid code until it clears.
- **Uniform refusals:** every group-scoped handler answers a non-member exactly like a missing group ("Group not found"); `leave_group` answers both with the same no-op `left_group`. The old "You are not a member of this group" message is gone.
- **Dashboard** join errors now show inline in the modal (no `alert()`).
- **Events (EVT-1):** `invite_opened {via: 'link'|'code', outcome: 'joined'|'rejoined'|'not_found'|'throttled'}` on every join attempt; `invite_code_reset {wasLegacy}`. No code values are logged.
- **Test-only hook:** `test_create_legacy_group` (AUTH_TEST_MODE only, which refuses to boot in production).
- **Legacy alias (REP-UI2-1):** `/group/:id?join=true` loads with `get_group` first and joins only if the caller is not a member; the query is stripped once the group loads. A non-member on a retired legacy link sees "Couldn't join this group — Invite code not found" (same page as a bad `/join/<code>`).
- **Tests:** `server/test/invites.test.js`, `web-app/e2e/invite-code.spec.js`; other specs join via the `inviteCodeFor` / `inviteJoinPath` helpers in `e2e/helpers.js` — new specs should use them, not `?join=true` or `{ groupId }`.

## Done when

- New groups get a CSPRNG code from the agreed alphabet/length; no `Date.now()` in the code.
- The internal group id is not the invite code; `join_group` accepts only an invite code; `get_group` and every other group-scoped handler refuse non-members.
- The host can reset the invite code; the old code stops working immediately and existing members are unaffected.
- The Invite modal shows the formatted code and a `/join/<code>`-style link with no query-string tail.
- Entering the code on the Dashboard "Join Group" flow works regardless of separators/case.
- Opening the shareable link joins the group and lands on `/group/:groupId`.
- Existing groups created before this change are still joinable (by code and by any legacy link kept as an alias).
- `cd web-app && npm run lint` no new errors (23 baseline warnings).
- Full `cd web-app && npx playwright test` green, with new coverage for the code format and the join route.

## Depends on

None. Sequence after `EVT-1` (shared `server/server.js`).
