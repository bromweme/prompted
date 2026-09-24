# SEC-1 — Referrer policy, and retiring the last guessable invite codes

- **Status:** Implemented (Wave 20; no independent review yet).
- **Priority:** medium
- **Guarantee:** An invite code never leaves the site in a `Referer` header, and no group can be joined by guessing its id.

## Origin

Two pre-launch items that had been sitting in the notes since the `UI-2` review, both about a join capability leaking:

> (b) The web app sets no `Referrer-Policy`; `/join/<CODE>` relies on the browser default.
> (d) Legacy `GROUP…` groups stay joinable by their guessable id until the host resets the code (accepted; throttle is the brake) — consider a one-time reset of legacy codes before launch.

Neither was urgent while the site was effectively private. Both get harder to fix the longer it is not.

## Referrer policy

`/join/<CODE>` puts a join capability in the URL. With a full `Referer`, clicking anything off-site from that page — a submitted video's "Watch on YouTube" link, say — hands the code to wherever they land.

The modern browser default (`strict-origin-when-cross-origin`) already prevents this. The problem with relying on it is that the guarantee then belongs to the browser rather than to the app, and a default can differ or change. It is now stated in `web-app/index.html`.

**Not `no-referrer`**, which would be stricter: Google Identity Services checks the requesting origin, so stripping it entirely risks breaking sign-in for a privacy gain this app does not need. The path is the part worth hiding, and `strict-origin-when-cross-origin` hides exactly that.

A meta tag rather than a header because the web app is a static Vite build with no `render.yaml` or `_headers` — the tag travels with the build and needs no host configuration. The API server already sets its own through `helmet()`.

## Retiring legacy codes

A group created before `UI-2` has no `inviteCode`, so `effectiveCode` falls back to the group id — and those ids are `GROUP<timestamp>_<n>`. A timestamp is not a secret: the id can be guessed, and guessing it is a way into the group.

`UI-2` accepted this at the time on two grounds, both true: the join throttle brakes guessing, and a host can reset their own code. Neither is a reason to leave a guessable capability in place indefinitely, and "the host can fix it" is not a fix when the host does not know there is anything to fix.

`upgradeLegacyInviteCodes()` runs once in `start()`, after the invite index is built — that order matters, because `remove` has to find the entry keyed by the old id and `issue` has to see every code already in use. It is self-limiting: a group that has a code is never a candidate again, so it is a no-op on every later boot and safe to leave in place permanently.

**It breaks old invite links for those groups.** That is the change, not a side effect of it. Each host gets a notification and a host notice so they find out from the app rather than from a player saying the link stopped working.

The legacy fallback in `effectiveCode` is deliberately left in. It costs nothing, the tests still cover it, and removing it is a separate decision.

## Evidence

Two tests in `invite-code.spec.js`, both **proven red**. The interesting fault was the sneaky one: a migration that returns the right count while doing nothing at all. It passes an assertion on the return value, so the test asserts on the thing that matters instead — that the guessable id **stops resolving** and the issued code works.

The existing legacy-group tests still pass unchanged, because the test hook creates legacy groups after startup, so the fallback path stays covered.

## Also fixed here

A defect introduced by `PRIV-1` in Wave 18: `account-deletion.js` filtered host notices with `n.userId !== userId`, but `addHostNotice` writes `{ id, kind, message, createdAt }` and no notice has ever had a `userId`. The filter could never match, so it silently did nothing while reading as though it did something.

Its unit test passed because **the fixture was invented** — it gave the fake notices a `userId` the real code does not produce, so the test validated a data shape that does not exist. The filter is gone, the fixture now matches production, and the comment says why host notices are deliberately kept: they are the host's own operational record, their text is free-form, and pattern-matching a username out of prose would be guesswork that fails quietly.

## Not covered

- The `Referrer-Policy` is a meta tag, so it applies to the page and not to non-document requests. A real header is better if the frontend ever gets a host config; the tag is what works today with none.
- Nothing changes for groups that already had an issued code, which is every group created since `UI-2`.

## Depends on

`UI-2` (which separated the id from the invite code and created both of these loose ends).
