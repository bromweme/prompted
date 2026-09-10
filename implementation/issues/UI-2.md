# UI-2 — Group code is a guessable timestamp; shareable link is long and unpolished

- **Status:** Ready — but the alphabet/length and the link scheme need a quick product sign-off (see "Decisions needed"). User-reported in the triage batch.
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

## Decisions needed (before a wave picks this up)

1. Alphabet and length — confirm `A-Z` × 20, or choose another point.
2. Link scheme — confirm `/join/<code>` clean path is enough, or is an actual short-link service wanted.
3. Unified id+code (minimal) vs. split internal-id / rotatable-invite (larger).

## Done when

- New groups get a CSPRNG code from the agreed alphabet/length; no `Date.now()` in the code.
- The Invite modal shows the formatted code and a `/join/<code>`-style link with no query-string tail.
- Entering the code on the Dashboard "Join Group" flow works regardless of separators/case.
- Opening the shareable link joins the group and lands on `/group/:groupId`.
- Existing groups created before this change are still joinable (by code and by any legacy link kept as an alias).
- `cd web-app && npm run lint` no new errors (23 baseline warnings).
- Full `cd web-app && npx playwright test` green, with new coverage for the code format and the join route.

## Depends on

None (but blocked on the three decisions above).
