# PRIV-1 — Privacy policy page + consent management (CMP)

- **Status:** Part A implemented (Wave 18); Part B still `Blocked` (no tracker or ad exists yet, so no consent mechanism is triggered).
- **Legal review: deliberately deferred** (user decision, 23 Sep 2026). Not legal advice, and the page says as much in a comment — but this is a side project with no revenue, ads or analytics, and the policy is accurate about what the code does, which is the protection that actually matters. The trigger conditions for revisiting are in **Before go-live** in `implementation-queue.md`: money changing hands, an ad or analytics tag shipping, real EU scale, or a data request whose answer is not obvious.
- **Contact address:** `prompted.thegame@gmail.com`, a real mailbox, replacing an earlier placeholder on a domain with no mail configured. It has to stay monitored — access, correction and portability requests arrive there; erasure does not, being self-service in the app. The controller is named as *Michael Bromwell*, inferred from the git author, and is the last unconfirmed item in **Before go-live**.
- **Priority:** medium
- **Guarantee:** The app has a real, linked privacy policy that accurately describes what it collects and shares, and — once any non-essential tracker or ad is added — a compliant consent mechanism gates it.

## Why now

`web-app/src/pages/Login.jsx:89` already tells users "By continuing, you agree to our Terms of Service and Privacy Policy" — but **no such policy page exists** and the text is not even a link. The app already collects personal data (Google account, content) and the stated future direction (analytics → ads, see the monetization note in `implementation-queue.md`) makes a policy + CMP a hard prerequisite.

## What the app collects / shares today (grounded)

- **Google sign-in** (Google Identity Services): email, display name, avatar URL, Google account id (`sub`). Verified client-side token, established server-side.
- **Session token**: server-minted, `SESSION_SECRET`-signed, ~30-day TTL (`config.sessionTtlDays`). Strictly-necessary (keeps players signed in across socket reconnects). Note: tokens currently **cannot be revoked** (existing note `f.norevoke`).
- **User-generated content**: group names/descriptions, topic/prompt text (incl. "public" ones shared with groupmates), submitted YouTube video ids + titles, vote comments.
- **Connection metadata**: IP address is visible to the server / socket layer and may appear in logs.
- **Third parties**:
  - Google (authentication).
  - YouTube Data API v3 — the server sends the user's **search query** to Google when searching for videos.
  - `youtube-nocookie.com` for video embeds (already the privacy-preserving variant — good).
  - Future, not yet present: first-party event logging (`EVT-1` — no third party, disclosure only), then analytics (GA4 / Plausible) and ads (AdSense) — each adds third-party sharing and, for GA4/ads, a consent requirement.

## Two parts

### Part A — Privacy policy page (draftable now, needs review)

- A `/privacy` route + page, linked from the login screen (make the `Login.jsx:89` text real links) and a footer.
- Content: what is collected and why; legal basis; the third parties above; retention (define it — ties to `EVT-1` retention and the session TTL); user rights (access, correction, deletion) and how to exercise them; contact. Note the current gaps honestly or fix them: the **Deactivate account button is a stub** (`f.ui-dead`) and there is **no data-deletion path** — a real policy that promises deletion needs one built, or the promise scoped.
- A matching Terms of Service page is referenced by the same line — decide if it is in scope here or a sibling issue.

### Part B — Consent management (Blocked until a tracker/ad exists)

- **Not required for `EVT-1`** (first-party, no cookies, no third-party sharing) or for the strictly-necessary session token — those only need disclosure in Part A.
- **Required before** GA4, any ad tag, or any other non-essential cookie/tracker, for EU/UK/California users: a Google-certified CMP (e.g. Cookiebot, Osano, Iubenda, Google's own) or a carefully-built banner that blocks the tracker until opt-in and records consent. Personalized ads raise the bar (IAB TCF / Google EU user consent policy).

## Decisions settled (Wave 18)

1. **Deletion**: build a real path now, rather than "email us". Done — see below.
2. **Terms of Service**: out of scope. The sign-in line now names only the Privacy Policy, because that is the only document that exists. A ToS is a separate artifact with different content (acceptable use, liability, termination) and inventing one to make a sentence true would repeat the original mistake.
3. **Jurisdictions**: EU/UK + California. Anyone can reach the site and nothing gates by region, so the broader shape was the only defensible one.

Still open: 4 (CMP choice) and 5 (retention windows) — 4 is Part B, and 5 is now answered in the policy itself (12 months for events, 30 days for sessions, until deletion for content).

## Decisions needed (original)

1. Who is the data controller (individual / entity), and which jurisdictions must the policy cover (EU/UK/US-CA at least)?
2. Is a data-deletion / account-closure path in scope now (making the Deactivate stub real), or is the policy scoped to "email us to delete"?
3. Terms of Service: in scope here or separate?
4. CMP: build-minimal vs a paid certified CMP — decide when Part B is triggered.
5. Data retention windows for content, sessions, and `EVT-1` events.

## What Part A actually did (Wave 18)

### The policy

`/privacy`, a **public** route — it is linked from the sign-in screen, so it has to be readable by someone who has not signed up yet. The content was written from the code rather than from intent: the collection list maps to `auth.js`, the four `PersistentStore`s, `events.js` and `youtube.js`.

The sign-in line changed from a claim to a link, and lost its Terms of Service half.

### Real deletion, because the policy promises it

`server/account-deletion.js`, with its stores injected so the semantics can be unit-tested directly rather than through a socket. Three rules, each of which is a judgement call worth recording:

| Rule | Why |
|---|---|
| Erase what is theirs, **anonymise what is shared** | Deleting a round's submissions and votes would silently rewrite other players' scores. Those records lose their owner instead of their existence. |
| A hosted group is **handed over**, not destroyed | `leave_group` refuses to let a host leave at all, because a host-less group is unmanageable. Deletion cannot refuse, so the group goes to the longest-standing remaining member — and is deleted only when nobody else is in it. Destroying other people's group because one member left is the worse failure. |
| **A ban outlives the account** | Google returns the same `sub` forever, so clearing bans would make deletion a moderation-evasion route. The one place a deleted user's id deliberately survives, and the policy says so rather than making a quiet exception. |

Each deletion gets a **unique** tombstone. A shared `'deleted'` sentinel would merge two deleted players into one identity and corrupt per-user round maths (`voteBudgetUsed`, the self-vote check) — that is a test, and it was proven by forcing a constant and watching exactly that one test go red.

Event-log rows are erased too, via a new `deleteEventsByActor` on both drivers. Rows are keyed by an HMAC of the user id, so the only way to find someone's is to hash the id the way `logEvent` did — which is what lets the log stay pseudonymous *and* be erasable. The deletion is recorded as an event with counts and **no actor**.

### What the tests caught

- A `ReferenceError: Cannot access 'closeDeleteModal' before initialization` — the whole Account page threw on render, so the deletion UI was entirely dead. `npm run build` succeeded, `oxlint` was clean and all 36 server unit tests passed. Only loading the page found it.
- The first version of the "group is gone" assertion was worthless: it looked for the server's internal `Group not found` string, but UI-2 deliberately shows a non-member the *same* page a missing group gives, so a stranger's view cannot tell the two apart. Rewritten to use the invite link, which a surviving group would have honoured.

## Not covered

- **Terms of Service** still does not exist. It is no longer claimed, which is the important half.
- **Sign-in tokens still cannot be revoked** (`f.norevoke`). Deleting an account does not invalidate an outstanding token; the policy states this rather than implying otherwise.
- **Notifications other players received** that mention the deleted player by name are left alone. They are other people's records, capped at 100 and transient.
- **Part B (consent management)** is untriggered and stays `Blocked`.

## Affected surface

| Area | Change |
|---|---|
| `web-app/src/pages/Login.jsx` | Make the policy/terms text real links. |
| `web-app/src/App.jsx` + new page(s) | `/privacy` (and maybe `/terms`) routes; footer link. |
| helmet CSP (`server/server.js`) | Part B only: a CMP script + any tracker needs `script-src`/`connect-src`/`frame-src` additions — plan a relaxed CSP for marketing pages vs strict in-game. |
| account / deletion | Decision 2 — possibly make Deactivate real. |

## Done when

- **Part A:** `/privacy` exists, is linked from login and a footer, accurately reflects the collection list above, and `Login.jsx` links work. Legal review is deferred by decision rather than outstanding — see Status.
- **Part B (when triggered):** no non-essential tracker/cookie loads before consent; consent choices are recorded and revocable; CSP updated deliberately.
- `cd web-app && npm run lint` clean; full `cd web-app && npx playwright test` green.

## Depends on

The decisions above. Part A pairs with `EVT-1` (disclosure). Part B is a prerequisite for GA4 / ads (monetization note).
