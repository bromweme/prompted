# UI-6 — Rename "topic" → "prompt" (page, route, and references)

- **Status:** Blocked — needs product decisions on scope and on the existing "topic" vs "theme" split (see "Open questions"). Filed from the triage batch; do not start until the questions are answered.
- **Priority:** medium
- **Guarantee (once scoped):** The user-facing term for a round's subject / a saved library item is "prompt", consistently, with no leftover "topic" (or stray "theme") in the surface the user sees.

## Request

"Change 'My Topics' to 'My Prompts', rename the page 'prompts', change any reference to topics to prompts."

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

### The blocker: "topic" and "theme" already mean the same thing here

The codebase uses **both** words for a round's subject:
- On the `/topics` page itself, the route/nav/H1 say "Topic" but every field and label inside `ThemeIdeas.jsx` says "Theme": `theme.text`, `.theme-text`, `<label>Theme Idea *</label>`, "Add New Theme", `editingTheme`, "No theme ideas yet".
- Round side: `group.currentTheme`, `theme.title`, `.theme-description`, `<h3>Current Theme</h3>`, the "Add Theme" button (`GroupView.jsx`), "Quick Theme Inspiration" (removed by `UI-5`).

So "change every reference to topics → prompts" leaves a page titled "My Prompts" with an "Add Theme" button and a "Theme Idea" field. The rename only reads as finished if "theme" is folded in too. `UI-4` already flags this inconsistency.

## Open questions (need answers before this is Ready)

1. **Scope.** Which of these?
   - **A — surface only:** rename the route (`/topics` → `/prompts`), the nav label, page H1, and visible strings. Leave socket events, `'topic_selection'`, the DB table, and JSON keys as internal "topic". Small, low-risk, ships in one wave; internal/user vocab diverge.
   - **B — full rename:** also rename the socket events, the phase string, the `topics` table, and the persisted `topicId` / `usedTopicIds` / status value. Needs a DB migration (rename the `topics` table; rewrite affected group blobs, or a dual-read shim) and a lockstep server+client change. Large; touches ~430 sites + tests.
2. **"theme".** Does "prompt" replace "theme" in the UI too (`Current Theme` → `Current Prompt`, `Add Theme` → `Add Prompt`, `ThemeIdeas.jsx` internals)? Recommended yes for a consistent result.
3. **Canonical term.** Is "prompt" the single canonical noun for this concept going forward (collapsing "topic" and "theme" into one word)? The product is named "Prompted", which argues yes.
4. **Docs.** In scope now, or a follow-up?
5. **e2e phase string.** Only relevant if scope B — confirm the test helpers get updated with it.

## Affected surface (fill in once scope is chosen)

- Scope A: `App.jsx` (route), `AppNav.jsx`, `ThemeIdeas.jsx` (copy; consider renaming the file/route to match), any other visible "topic"/"theme" strings, a redirect from `/topics` to `/prompts` for existing links/bookmarks.
- Scope B: everything in Scope A, plus `server/server.js` + all client socket call sites (event rename), `'topic_selection'` everywhere incl. e2e, `PersistentStore('topics')` + a `prompted.db` migration, persisted group-blob key migration, `TopicPicker.*` / `useTopics.js` renames.

## Done when

- Answers to the open questions are recorded here and the affected surface is filled in.
- No "topic" (and, per Q2, no stray "theme") remains in the user-visible surface within the agreed scope.
- Existing `/topics` links/bookmarks still resolve (redirect) if the route changes.
- If scope B: existing groups and saved library items load and work unchanged after the migration; the full e2e suite is updated and green.
- `cd web-app && npm run lint` no new errors (23 baseline warnings).

## Depends on

Product decision (the open questions). Overlaps `UI-4` (topic/theme wording) and `UI-5` (removes "Quick Theme Inspiration").
