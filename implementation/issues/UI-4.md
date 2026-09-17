# UI-4 — "Current Theme" section shows an empty theme and boilerplate before a theme is picked

- **Status:** In progress (Wave 10). JSX + CSS only, no product decision — but confirm the heading wording (options below).
- **Priority:** low
- **Guarantee:** During a round's `topic_selection` phase, the Current Theme section (Overview card and Round tab) must not present an empty theme title or generic boilerplate as if a theme were set.

## Observed

Screenshot from the user (Overview "Current Theme" card, `topic_selection`):

- Heading: "Current Theme" — but no theme is chosen.
- Body: "This round's music challenge" (the static `description`) shows as if it were the theme.
- Stats: `SUBMISSIONS0` and `DEADLINENot set yet` — the label and value run together with no separator.

## Current behavior (grounded)

Server (`server/server.js:439-452`): a fresh round has `title: null` and a constant `description: "This round's music challenge"`. `title` is filled at `select_topic`; `description` never changes.

Client renders the section in two places, both unconditionally:

- Overview card — `web-app/src/pages/GroupView.jsx:847-889`: `<h3>Current Theme</h3>`, `<h4>{group.currentTheme.title}</h4>` (empty during `topic_selection`), `<p className="theme-description">{group.currentTheme.description}</p>`.
- Round tab — `web-app/src/pages/GroupView.jsx:982-1009`: `<h3>Current Theme</h3>`, `<h4>{group.currentTheme.title}</h4>`, `<p className="round-description">{group.currentTheme.description}</p>`.

The Overview card also has a `.theme-status` badge that already says "Choosing a topic" in this phase (`:851-857`), and the Round tab has a "Getting started / Topic" phase block immediately below (`:1011-1017`).

Stat spacing: `.theme-stat` / `.round-stat` (`GroupView.css:241-244`) are `text-align: center` but hold two inline `<span>`s (`.stat-label`, `.stat-value`) with no block display and no gap, so they render as `SUBMISSIONS0`. Pre-existing; the RT-4 "Not set yet" placeholder just made it obvious.

## Requested changes (from the user)

1. When no theme is selected yet, change the "Current Theme" heading to something clearer than "Current Theme".
2. When no theme is selected yet, do not render the "This round's music challenge" text.
3. (found during review) Fix the `SUBMISSIONS0` / `DEADLINENot set yet` run-together spacing while in this section.

## Heading wording — options (pick one)

- **"Choosing This Round's Theme"** — active, says what is happening. Recommended.
- **"No Theme Selected Yet"** — the user's literal suggestion; plain and clear.
- **"Waiting for the Judge's Theme"** — frames it as the Judge's action.
- **"Theme — Not Chosen Yet"**
- Keep `<h3>` as the round label ("Round N") in this phase and let the existing `.theme-status` badge / phase block carry the "choosing" state.

Note: the UI mixes "topic" (`topic_selection`, the picker's "Pick a topic") and "theme" ("Current Theme"). If the heading says "Theme", the adjacent picker copy should probably say "theme" too. Full topic/theme unification is out of scope here — flag only.

## Proposed change

- Gate on `group.currentTheme.title` (the real "theme chosen" signal), in both the Overview card and the Round tab:
  - No title → heading uses the chosen "no theme yet" wording; do **not** render the empty `<h4>` or the `description` `<p>`.
  - Title present → unchanged ("Current Theme", the title, and the description as today).
- Stat rows: make `.stat-label` / `.stat-value` stack (label `display: block`, small `margin-bottom`) or add a separator, so `Submissions` / `0` and `Deadline` / `Not set yet` are readable. Apply to `.theme-stat` and `.round-stat`. Verify the `submission` / `voting` / `reveal` layouts still look right.

## Affected surface

| Area | Change |
|---|---|
| `web-app/src/pages/GroupView.jsx` | Conditional heading + hide empty `<h4>` / description in the Overview `.current-theme-card` (~847-889) and the Round `.round-info-card` (~982-1009). |
| `web-app/src/pages/GroupView.css` | `.theme-stat` / `.round-stat` / `.stat-label` spacing. |
| e2e | Add/extend coverage: in `topic_selection` the section shows the new heading and no `"This round's music challenge"`; after `select_topic` it shows "Current Theme" + the title. Check no existing spec asserts `getByText('Current Theme')` unconditionally (a quick grep before changing). |

## Done when

- In `topic_selection`, both the Overview card and the Round tab show the agreed "no theme yet" heading and do not render the empty title line or the `"This round's music challenge"` text.
- After a theme is picked, both show "Current Theme", the theme title, and the description, as today.
- `Submissions` / `Deadline` stat labels and values are visually separated in every phase.
- `cd web-app && npm run lint` no new errors (23 baseline warnings).
- Full `cd web-app && npx playwright test` green.

## Depends on

None. (Sits in the same section as `RT-4`, already `Done`.)
