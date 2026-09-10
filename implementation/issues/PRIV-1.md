# PRIV-1 — Privacy policy page + consent management (CMP)

- **Status:** Blocked on product/legal decisions (data controller identity, jurisdictions, CMP choice). The policy-page *scaffold* and the disclosure of current data practices can be drafted now; the CMP piece is only triggered by third-party trackers/ads. **Not legal advice — a lawyer should review the final policy.**
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

## Decisions needed

1. Who is the data controller (individual / entity), and which jurisdictions must the policy cover (EU/UK/US-CA at least)?
2. Is a data-deletion / account-closure path in scope now (making the Deactivate stub real), or is the policy scoped to "email us to delete"?
3. Terms of Service: in scope here or separate?
4. CMP: build-minimal vs a paid certified CMP — decide when Part B is triggered.
5. Data retention windows for content, sessions, and `EVT-1` events.

## Affected surface

| Area | Change |
|---|---|
| `web-app/src/pages/Login.jsx` | Make the policy/terms text real links. |
| `web-app/src/App.jsx` + new page(s) | `/privacy` (and maybe `/terms`) routes; footer link. |
| helmet CSP (`server/server.js`) | Part B only: a CMP script + any tracker needs `script-src`/`connect-src`/`frame-src` additions — plan a relaxed CSP for marketing pages vs strict in-game. |
| account / deletion | Decision 2 — possibly make Deactivate real. |

## Done when

- **Part A:** `/privacy` exists, is linked from login and a footer, accurately reflects the collection list above, and has been reviewed (ideally by a lawyer). `Login.jsx` links work.
- **Part B (when triggered):** no non-essential tracker/cookie loads before consent; consent choices are recorded and revocable; CSP updated deliberately.
- `cd web-app && npm run lint` clean; full `cd web-app && npx playwright test` green.

## Depends on

The decisions above. Part A pairs with `EVT-1` (disclosure). Part B is a prerequisite for GA4 / ads (monetization note).
