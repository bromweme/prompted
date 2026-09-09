# GL-2 — Fix the dead Edit Video path and the misleading Overview phase label

- **Status:** Implemented
- **Priority:** medium
- **Depends on:** none
- **Source finding:** `f.ui-dead` (deep-discovery)
- **Owner:** `web-app/src/pages/GroupView.jsx` (single worker; no server change)
- **Wave result:** Implemented in Wave 1. Dead `isEditing` Edit-Video branch removed; Overview phase label now switches on real status. Full chromium suite green.

## What is broken

Two defects live in `web-app/src/pages/GroupView.jsx`:

1. **Edit Video is unreachable.** `setIsEditing(true)` is never called, so the submit modal is always in "submit a new video" mode. Yet the modal title and button branch on `isEditing` (`GroupView.jsx:1672` shows "Edit Video"/"Submit Video"; `:1717` shows "Update Video"/"Submit Video"), so there is dead code that implies an editing mode that can never appear.
2. **The Overview phase label mislabels `topic_selection`.** The status ternary at `GroupView.jsx:672` renders `'Submissions Open'` for any phase that is not `voting` or `reveal`. During `topic_selection`, before a topic exists, the label incorrectly says "Submissions Open".

## Intended behavior

For issue 1, choose the behavior that is simplest and honest: **remove the unreachable Edit mode** — hard-set the modal to submit mode, drop the `isEditing` branch, and use the plain "Submit Video" title and button. (There is no actual edit-submission flow; the product lets a player resubmit by nothing except the phase closing, so the edit branch is dead weight, not a deferred feature.)

For issue 2, render a label that matches the real phase:

- `topic_selection` → `Choosing a topic`
- `submission` → `Submissions Open`
- `voting` → `Voting`
- `reveal` → `Results`

Make the label switch on the actual phase rather than a fallback.

## Done conditions

- [ ] No `isEditing` reaches the submit modal title or button; the modal consistently shows "Submit Video".
- [ ] No `setIsEditing` call remains on the submit path (or, if a reset is kept, it only resets form state and drives no visible branch). The `isEditingRules` path (rules editor) is unrelated and must keep working.
- [ ] The Overview status label renders the four values above, with no misleading "Submissions Open" during `topic_selection`.
- [ ] `web-app/e2e/round-phases.spec.js` and `web-app/e2e/group-layout.spec.js` still pass.
- [ ] No server behavior changes.

## Repository checks

- `cd web-app && npx playwright test --project=chromium` (round-phases and group-layout must pass).
- `cd web-app && npm run lint` (oxlint; no new errors).
- Do not edit `implementation-queue.md` or any `issues/*.md`; do not commit; do not push.