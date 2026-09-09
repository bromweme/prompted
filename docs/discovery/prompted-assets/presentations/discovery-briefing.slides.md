# Prompted — Discovery Briefing and Engineering Onboarding

**Format:** 16:9, neutral style. 18 slides, about 25 minutes with questions.
**Audience:** mixed. Slides 1–11 brief anyone; 12–17 are for engineers. Stop after slide 11 for a product-only audience.

**Authoring status:** this is a complete storyboard, not a rendered deck. No PowerPoint authoring library was available in this environment (`python-pptx` is not installed), so **no `.pptx` file exists**. Every slide below is ready to build.

Every claim carries its source in the speaker notes. Nothing on a slide is unsourced.

---

## Slide 1 — Title

> # Prompted
> ## What we actually built
> Current-state discovery · 9 September 2026 · revision `cfa08f6`

**Notes:** This is a discovery of what exists today. No proposals, no roadmap. Everything is traceable to a file and a line.

---

## Slide 2 — The product in one sentence

> A Judge sets a prompt.
> Everyone else answers it with **one YouTube video**.
> Everyone votes. A winner is scored.
>
> Groups are **standing** — the same people play round after round.

**Notes:** Closest comparison is MusicLeague, and the README says so. The differentiator is the Judge: an anonymous adjudicator. Source: `README.md` game concept; `server/server.js:244-480`.

---

## Slide 3 — The headline

> ## The documentation describes a different product.

**Notes:** Let this land before the table. This is the single most consequential finding, because it is the first thing a new contributor reads. Finding `f.docs`.

---

## Slide 4 — How different

| The documents say | The build does |
|---|---|
| Spotify | YouTube Data API v3 |
| PostgreSQL | SQLite (WAL) |
| React Native app under `src/` | No mobile app exists |
| In-memory, no accounts | Google Sign-In, persisted profiles |
| Games joined by code | Groups; the id *is* the code |
| Public topics app-wide | Public topics only among groupmates |

**Notes:** Verified item by item, not assumed. `README.md` also contradicts *itself* on Spotify — current mechanism in one section, unbuilt future work in two others. Evidence `ev.docs.stale`, `ev.docs.selfconflict`.

Important nuance for the room: the `.env.example` files **are** accurate. This is a problem with two hand-written documents, not with the team's documentation habits.

---

## Slide 5 — What is genuinely well built

> - Identity is verified once and **bound to the connection** — no handler trusts a message
> - Concealment works by **withholding data**, not hiding it in the UI
> - Rules are enforced server-side, and several are proven with payloads no browser could send
> - 65 tests × 4 browsers, and a static guard caught a real regression this refresh fixed

**Notes:** Say this before the problems, and mean it. A test asserts the Judge's id appears in **no websocket frame** before reveal — that checks wire traffic, not the DOM. A modified client cannot cheat. Findings `f.authority`, `f.privacy`; evidence `ev.judge.hidden.test`, `ev.selfvote.test`. At investigation time the `css-tokens` static guard was failing on a real undefined-token regression in the new host-notice styling; it is fixed in this refresh, which is itself a live demonstration of the guard working.

---

## Slide 6 — Problem 1: the stall is fixed, but the edges remain

> The submission deadline is **now enforced** — that was the prior discovery's top finding, and it is closed by `advanceIfExpired`.
>
> But: no-submission rounds restart the *same* round up to **three times**, then stall for the host; enforcement only happens **when someone pings the group**; and **voting has no deadline** — once in `voting`, nothing forces reveal and the host has no escape.

**Notes:** What a brief must convey is the shape of the fix, not just that it happened. `advanceIfExpired` evaluates the stored deadline at interaction moments (join, group read, submit, start, and a client countdown nudge), pulls the round into voting when submissions exist, and otherwise re-arms the same round — same Judge, same topic, `currentRound` not incremented — up to `MAX_AUTO_REARMS` = 3, then stalls for the host with a durable notice. There is deliberately no scheduler, so a group nobody pings does not advance on its own. Voting is the gap: `votingTime` is never read and `close_submissions` only works during submission. Finding `f.deadline`; evidence `ev.deadline.contract`, `ev.deadline.rearm`, `ev.deadline.novoting`.

---

## Slide 7 — Problem 2: nine settings do nothing

> The wizard collects **21** settings.
> The server reads **9**.
>
> `totalRounds` · `maxPlayers` · `allowSkipCzar` · `votingTime` · `autoStart` · `allowCustomTopics` · `enableChat` · `enableSongPreview` · `showVoterIdentity`

**Notes:** The two worst are `totalRounds` and `maxPlayers`, because they are **displayed** — "Round 3/6", "4/12 players" — implying limits that are never applied. Nothing ends a group; nothing stops a thirteenth player. `submissionTime` is the one setting that was collected for display and is now genuinely enforced.

`allowDownvotes` is a separate category: enforced in the client only, so a crafted payload bypasses it. Finding `f.settings`.

---

## Slide 8 — Problem 3: Leave and Delete do nothing

> Both buttons confirm with the user.
> Both then call `navigate('/dashboard')`.
> **No event is sent. No handler exists.**

**Notes:** The client emits 15 socket events; neither `leave_group` nor `delete_group` is among them, and the server has no handler for either. A player who "leaves" is still a member. A host who "deletes" still owns the group. Finding `f.leave`; evidence `ev.leave.noevent`.

---

## Slide 9 — Two more worth a decision

> **A downvote costs points twice.** The target is docked *and* the voter is charged — unconditionally, even if the downvoted entry loses.
>
> **The host role is permanent.** No transfer path exists. An absent host permanently blocks new rounds.

**Notes:** The downvote behavior may well be intended — a disincentive plus a penalty. But both documents say only "downvotes cost points," which does not settle it, so it needs a decision rather than an assumption. Findings `f.downvote`, `f.host`.

---

## Slide 10 — What the tests do not cover

> 1. **Scoring variety** — every round resolves through one branch, at 100% vote share
> 2. Real Google sign-in and the real YouTube API — bypassed by design
> 3. Mid-round disconnect and reconnect
> 4. **Keyboard focus states**
> 5. The voting deadlock and the `totalRounds` group ending

**Notes:** Item 1 matters most: the popular-vote fallback, vote splits, ties, a legitimate downvote against another player, and every non-default point value are untested. Finding `f.scoringuntested`. The deadline contract, by contrast, is now well covered by `round-deadline.spec.js` — that is no longer a gap.

Item 4 is worth admitting plainly: we built a hover audit after a real invisible-button bug, but the static lint exempts `:focus` and the runtime audit simulates hover only. The exact bug class we fixed is uncovered for the state keyboard users depend on. Finding `f.focusgap`.

---

## Slide 11 — Open questions for people, not code

> 1. Should the Judge **both vote and pick** the winner outright?
> 2. Is a downvote meant to cost the voter as well as the target?
> 3. Should voting get a **deadline or a host escape**, to match the submission deadline?
> 4. Was skip-Judge dropped, or never built? Its setting is still collected.
> 5. What is the role called — **Judge, czar, or Round Leader**? All three are in the code.
> 6. Should a group end after `totalRounds`?

**Notes:** Question 3 is the live product gap now that the submission deadline is enforced — a round can sit in voting indefinitely. Question 4 is not cosmetic: three names for one concept makes every discussion and every code search ambiguous. Question 1 is the one with real game-design weight — the code and the documents agree it is allowed, but nothing records whether giving one person two levers on the same outcome was ever weighed. The mobile-app question from the prior discovery is resolved: there is no mobile app in this repository.

**Stop here for a product-only audience.**

---

## Slide 12 — Engineering: the shape

> Two processes. One SQLite file. Two external services.
> **No REST API for gameplay** — socket.io carries everything: 23 events in, 12 out.

**Notes:** Show `architecture/system-runtime.mmd`. The auth middleware sits between the channel and every handler, which is what makes authorization enforceable rather than advisory.

---

## Slide 13 — Engineering: the round

> `topic_selection → submission → voting → reveal`
>
> Transitions are driven by a **player action** or by `advanceIfExpired` reading a **stored deadline** at an interaction moment.
>
> Deliberately **no scheduler**: a quiet group advances only when someone pings it.

**Notes:** Show `architecture/round-lifecycle.mmd` with the three annotations (topic-selection has only a host `reassign_judge` escape; submission re-arms up to 3 times then stalls; voting has no deadline). This diagram *is* slide 6, drawn. `advanceIfExpired` at `server/server.js:198-238`.

---

## Slide 14 — Engineering: concealment

> Each phase strips what it must not reveal **from the payload**.
>
> `topic_selection` / `submission` → no submissions, no votes, no Judge
> `voting` → submissions **without authors**; comments only if enabled, never attributed
> `reveal` → everything

**Notes:** Show `architecture/round-concealment.mmd`. `publicizeTheme` at `server/server.js:286-330` is the most important function in the codebase. Read it before changing anything about rounds.

---

## Slide 15 — Engineering: read in this order

> 1. `server/server.js:198-238, 244-375` — the deadline seam, then the whole game
> 2. `server/server.js:486-530` — how identity is bound
> 3. `server/db.js`, `server/profiles.js` — all persistence
> 4. `web-app/src/pages/GroupView.jsx` — the product
> 5. `web-app/e2e/round-phases.spec.js` + `round-deadline.spec.js` — the real specification

**Notes:** Do not start with `README.md`. Full path in `onboarding-guide.md`.

---

## Slide 16 — Engineering: three traps

> - **`PersistentStore.get()` returns the live object.** Mutate without `set()` and disk drifts silently.
> - **Never restyle a shared button class from a page stylesheet.** It loads after `index.css` and applies app-wide.
> - **Never use an undefined `var()`.** The whole declaration is dropped; `background` falls back to transparent.

**Notes:** The last two are not hypothetical — together they made every primary button in the app invisible while the suite stayed green. `css-tokens.spec.js` now fails the build for either. Evidence `ev.css.invisible`, `ev.db.mutationhazard`.

---

## Slide 17 — Engineering: test at the right level

> A rule the **server** enforces needs a **raw socket test**.
> A UI test would pass even if the server check were deleted.

**Notes:** The self-vote test sends a payload no interface could produce. That is the pattern to copy whenever you add a server-side rule. `retries: 0` is deliberate — a failing test means something is actually broken.

---

## Slide 18 — Where everything lives

> **Report** · `docs/discovery/prompted-deep-discovery.md`
> **Package** · `docs/discovery/prompted-assets/index.md`
> **Model** · `prompted-assets/knowledge-base/application-model.json`
> **Evidence** · `prompted-assets/knowledge-base/evidence-catalog.md`
> **Atlas** · `prompted-assets/architecture/atlas.md`
> **Onboarding** · `prompted-assets/onboarding-guide.md`

**Notes:** Findings marked from static analysis come from reading code, not watching it run. No capability is marked "observed working" — the app was read and its suite was run, never driven by hand. That distinction is preserved in the model.
