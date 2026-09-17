# UI-5 — Remove the "Quick Theme Inspiration" section from the My Topics page

- **Status:** In progress (Wave 10). JSX + CSS delete, no product decision.
- **Priority:** low
- **Guarantee:** The My Topics page (`/topics`) no longer shows the "Quick Theme Inspiration" grid. The rest of the page (header, Add Theme, the theme list, the add/edit modal) is unchanged.

## Observed

Screenshot from the user: `/topics` renders a "Quick Theme Inspiration" section with six preset cards (Childhood Favorites, Rainy Day Vibes, Summer Hits, Study Focus, Energy Boosters, Evening Wind Down). The user does not want this section here for now. The idea of offering suggestions is worth keeping — revisit later (see the out-of-scope note added to `implementation-queue.md`).

## Current behavior (grounded)

- `/topics` route → `web-app/src/pages/ThemeIdeas.jsx` (`App.jsx:49`).
- The section is `web-app/src/pages/ThemeIdeas.jsx:113-141`: `<section className="quick-ideas-section">` with six `.quick-idea-card` divs. Each `onClick` does `setNewTheme('<preset>'); setShowAddModal(true)` — it prefills and opens the same Add Theme modal.
- `setNewTheme` and `setShowAddModal` are also used by the "Add Theme" button and the modal, so removing this section leaves no unused state.
- CSS for the section lives only in `web-app/src/pages/ThemeIdeas.css`: `.quick-ideas-section` (`:182`), `.quick-ideas-section h3` (`:190`), `.quick-ideas-grid` (`:197`), `.quick-idea-card` (`:203`), `.quick-idea-card:hover` (`:213`), `.idea-icon` (`:220`), `.quick-idea-card h4` (`:226`), and the two responsive overrides at `:349` and `:363`. These become dead and should be removed with the section.
- No e2e spec references the section, its classes, or the preset strings.

## Not in scope (confirm separately)

`web-app/src/pages/Account.jsx:280-...` has a near-identical "Quick Theme Inspiration" section on the `/account` page, with its own copy of the styles in `Account.css:348-393`. The user pointed only at the My Topics page. Leave `/account` as-is unless the user says otherwise.

## Affected surface

| Area | Change |
|---|---|
| `web-app/src/pages/ThemeIdeas.jsx` | Delete the `<section className="quick-ideas-section">` block (`:113-141`). |
| `web-app/src/pages/ThemeIdeas.css` | Delete the now-unused `.quick-ideas-*` / `.quick-idea-card` / `.idea-icon` rules, including the two `@media` overrides. |
| e2e | None reference it; run the full suite to confirm the page still renders and the Add Theme flow works. |

## Done when

- `/topics` shows no "Quick Theme Inspiration" section; the theme list and Add Theme modal work exactly as before.
- `ThemeIdeas.css` has no dead `.quick-idea*` rules.
- `/account`'s equivalent section is untouched.
- `cd web-app && npm run lint` no new errors (23 baseline warnings).
- Full `cd web-app && npx playwright test` green.

## Depends on

None.
