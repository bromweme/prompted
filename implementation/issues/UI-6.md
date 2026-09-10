# UI-6 — Rename "topic" and "theme" → "prompt" (page, route, and references)

- **Status:** Blocked — still needs a scope decision (surface-only vs full rename) and a docs-scope call. The "theme" question is **answered: yes** (see "Decisions recorded"). Filed from the triage batch.
- **Priority:** medium
- **Guarantee (once scoped):** The user-facing term for a round's subject / a saved library item is "prompt", consistently. No leftover "topic" **and no leftover "theme"** in the surface the user sees, within the agreed scope.

## Request

"Change 'My Topics' to 'My Prompts', rename the page 'prompts', change any reference to topics to prompts." Plus (follow-up): **"theme" is replaced with "prompt" too** — the two words are used interchangeably for the same concept.

## Decisions recorded

- **"theme" → "prompt" is IN SCOPE (user-confirmed).** Every user-visible "theme"/"Theme" string that refers to a round's subject or a saved library entry becomes "prompt"/"Prompt". Inventory below. This is not optional cleanup — a rename that changed only "topic" would leave a "My Prompts" page with an "Add Theme" button and a "Theme Idea" field.
- Supporting evidence: `GAME_DESIGN.md` already uses **"prompt"** as the design term ("players submit songs based on prompts", "Card Czar selects or creates a prompt"). "topic" and "theme" are both implementation drift from that. So "prompt" is the canonical noun (open question 3 → effectively yes).
- Still open: scope A vs B (below), and whether docs are renamed now or later.

## User-visible "theme" strings to change (verified in code)

| File | Line | Current | → |
|---|---|---|---|
| `web-app/src/pages/ThemeIdeas.jsx` | 59 / 198 | "Add Theme" / "Update Theme" | "Add Prompt" / "Update Prompt" |
| `ThemeIdeas.jsx` | 149 | modal title "Edit Theme" / "Add New Theme" | "Edit Prompt" / "Add New Prompt" |
| `ThemeIdeas.jsx` | 67-68 | "No theme ideas yet" / "Start saving your creative theme ideas!" | "No prompts yet" / … |
| `ThemeIdeas.jsx` | 161 / 166 | `<label>Theme Idea *</label>` / placeholder "Enter your theme idea …" | "Prompt *" / "Enter your prompt …" |
| `ThemeIdeas.jsx` | 56 / 91 / 98 | aria-labels "Add new theme idea" / "Edit {text}" / "Delete {text}" | "…prompt…" |
| `web-app/src/pages/GroupView.jsx` | 849 / 984 | `<h3>Current Theme</h3>` | "Current Prompt" (coordinate with `UI-4`, which conditionalises this heading) |
| `GroupView.jsx` | 937 | "Themes Played" | "Prompts Played" |
| `GroupView.jsx` | 1452 / 1502 | "Theme History" / "Theme history will appear here …" | "Prompt History" / … |
| `web-app/src/pages/Account.jsx` | 214 / 235-236 / 281 / 435 / 440 | "Theme Ideas", "No theme ideas yet", "Quick Theme Inspiration", "Theme Idea *", placeholder | "…Prompt…" (Account's "Quick Theme Inspiration" is out of `UI-5`'s scope; fold its copy in here) |
| `Account.jsx` | 107-108 / 211 | account tab key `'themes'` (also affects `?tab=` if linkable) | `'prompts'` |
| `web-app/src/components/TopicPicker.jsx` | 60 / 116 | "Choose this round's topic" / "Add to my topics" | "Choose this round's prompt" / "Add to my prompts" |
| `CreateGroup.jsx` | 225 | placeholder "Describe your group theme" | leave — this is the group's *description*, a different sense of "theme"; confirm during implementation |

Non-visible identifiers that the rename touches for consistency (safe, local): `editingTheme`, `newTheme`, `theme.text`/`theme.title` locals, `.theme-text` / `.theme-description` / `.current-theme-card` / `.theme-*` CSS classes, `ThemeIdeas.jsx` filename. `group.currentTheme` (persisted) falls under the scope A/B decision.

## Review of the current code against this request

"topic" is not just UI copy — it runs through every layer:

**User-facing copy / routing**
- Route `/topics` → component `web-app/src/pages/ThemeIdeas.jsx` (`App.jsx:49`). Note the file is already named `ThemeIdeas`, not `Topics`.
- `web-app/src/components/AppNav.jsx:37-41`: nav item key `'topics'`, label "My Topics", `navigate('/topics')`.
- `ThemeIdeas.jsx` H1 "My Topics".

**Wire protocol — socket event names (server + client, lockstep)**
`get_topics`, `topics_list`, `get_group_topics`, `group_topics_list`, `submit_topic`, `topic_submitted`, `select_topic`, `delete_topic`, `topic_deleted`.

**Round phase status string**
`'topic_selection'` — the first round phase. Used in `server/server.js` (multiple), `web-app/src/pages/GroupView.jsx` (multiple), and e2e helpers/specs (`inPhase('topic_selection')` in `judge-skip`, `vote-budget`, `round-phases`, `game-loop`, `round-deadline`). It is also persisted inside `group.currentTheme.status`.

**Persisted storage**
- `server/server.js:48`: `new PersistentStore('topics')` → a `topics` table in `server/prompted.db` (has live rows).
- Persisted group fields: `group.currentTheme.topicId`, `group.usedTopicIds`, `group.currentTheme.status === 'topic_selection'`. Old group blobs on disk carry these keys.

**Component / file / CSS names**
`web-app/src/components/TopicPicker.jsx`, `TopicPicker.css`, `.topic-picker`; `web-app/src/hooks/useTopics.js`.

**Docs**
`GAME_DESIGN.md`, `README.md`, `docs/discovery/*`, `docs/design/*` — ~97 lines mention "topic".

**Rough size:** ~430 "topic" occurrences across `server/`, `web-app/src/`, `web-app/e2e/`, plus ~97 doc lines.

### Why "topic" and "theme" both have to go

The codebase uses **both** words for a round's subject / a library entry:
- On the `/topics` page, the route/nav/H1 say "Topic" but every field inside `ThemeIdeas.jsx` says "Theme".
- Round side: `group.currentTheme`, `<h3>Current Theme</h3>`, "Themes Played", "Theme History".

Both map to the design doc's single term, "prompt". The user has confirmed "theme" is folded into this rename (see "Decisions recorded"). Overlaps `UI-4` (conditionalises the "Current Theme" heading) and `UI-5` (removes the `/topics` "Quick Theme Inspiration"; the `/account` twin is picked up here).

## Open questions (still needed before this is Ready)

1. **Scope.** Which of these?
   - **A — surface only:** rename the route (`/topics` → `/prompts`), the nav label, page H1, and all visible "topic"/"theme" strings (inventory above + the "topic" list). Leave socket events, `'topic_selection'`, the DB table, and JSON keys (`currentTheme`, `topicId`, …) as internal names. Small, low-risk, one wave; internal vs user vocab diverge.
   - **B — full rename:** also rename the socket events, the phase string, the `topics` table, and the persisted `currentTheme` / `topicId` / `usedTopicIds` / status value. Needs a `prompted.db` migration (rename the `topics` table; rewrite affected group blobs, or a dual-read shim) and a lockstep server+client change. Large; ~430 "topic" sites + ~280 "theme" sites + tests.
2. **Docs.** `GAME_DESIGN.md` / `README.md` / `docs/*` — in scope now, or a follow-up? (They already lean on "prompt", so mostly it's replacing "topic"/"theme" mentions.)
3. **e2e phase string.** Only relevant under scope B — confirm the test helpers (`inPhase('topic_selection')` etc.) get renamed with it.

## Affected surface (fill in once scope is chosen)

- Scope A: `App.jsx` (route), `AppNav.jsx`, `ThemeIdeas.jsx` (copy; consider renaming the file/route to match), any other visible "topic"/"theme" strings, a redirect from `/topics` to `/prompts` for existing links/bookmarks.
- Scope B: everything in Scope A, plus `server/server.js` + all client socket call sites (event rename), `'topic_selection'` everywhere incl. e2e, `PersistentStore('topics')` + a `prompted.db` migration, persisted group-blob key migration, `TopicPicker.*` / `useTopics.js` renames.

## Done when

- The scope (A or B) and docs question are answered and the affected-surface list is finalised.
- **No user-visible "topic" and no user-visible "theme"** (for this concept) remain, within the agreed scope — verified by a grep of rendered strings.
- Existing `/topics` links/bookmarks still resolve (redirect) if the route changes.
- If scope B: existing groups and saved library items load and work unchanged after the migration; the full e2e suite is updated and green.
- `cd web-app && npm run lint` no new errors (23 baseline warnings).
- Full `cd web-app && npx playwright test` green.

## Depends on

Product decision (scope A/B, docs). Sequence after `UI-4` and `UI-5` (both touch the same "theme" copy) — or fold all three into one wave.
