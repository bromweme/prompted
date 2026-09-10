# RT-3 — Judge can skip their turn, with a fair no-repeat rotation

- **Status:** Ready
- **Priority:** medium
- **Depends on:** none
- **Source:** Product Brief `docs/planning/gameplay-round-timing-product-brief.md` (defining scenario "A Judge wants to pass"); design `docs/design/a2-judge-skip-change-design.md`.
- **Owner:** `server/server.js` (primary: new `judge_skip` event + rotation bookkeeping), `web-app/src/pages/GroupView.jsx` (Skip control in the topic picker), e2e.

## Useful outcome

A Judge who gets the role and doesn't want to hold it can **skip their turn**, and the group is not forced onto the host to fix it. Skipping re-assigns the Judge role to another member at random, with fairness: nobody has to judge twice until everyone has judged once. If the whole group keeps skipping, the round reverts to the **first-assigned Judge**, who is not offered the pass again — they must pick a topic.

## What changes

**Product behavior:**
- As soon as a player knows they are the Judge (the moment `topic_selection` begins), they see a "**Skip my turn**" control.
- Choosing skip re-assigns the Judge to a random member who has not already served as Judge in this cycle.
- The no-repeat rotation tracks **across rounds** (a group-level cycle): once you judge, you're skipped in future re-picks until every member has served once; then the cycle resets.
- If everyone skips (the pool is exhausted and the current Judge still declines), the role returns to the **first-assigned Judge**, who is **not** offered the pass — they must play.

**Technology changes:**
- `server/server.js`: a new **Judge-authorized** event (e.g. `judge_skip`), gated on `userId === theme.czarId` and `status === 'topic_selection'` (mirrors `reassign_judge`, server.js:940-969, but Judge-authorized, not host-authorized).
- Add a group-level **"already judged this cycle"** set (persists across rounds; resets when every eligible member has served). A skipped Judge counts as having served (rotates the cycle forward).
- Re-assign: pick a random other member not in the judged set; when the set is full/would repeat, revert to the first-assigned Judge and disable their skip affordance.
- Client (`GroupView.jsx` topic picker): add the "Skip my turn" control for the current Judge; surface the rotation state (who has/hasn't served) so it is legible; hide/disable the skip control for the mandatory first Judge.
- e2e: judge-skip tests including "already served" exclusion, cross-round rotation, and the full-skip-reverts-to-first-Judge guard.

## Requirements and delivery context

Product Brief commitments this issue must satisfy (see `docs/planning/gameplay-round-timing-product-brief.md`):
- A Judge can pass their turn; the role rotates fairly across the group. (Outcome)
- Nobody is forced to judge twice before everyone has judged once; when everyone skips, the first Judge plays. (Outcome / Business rule, decision A2)
- The rotation tracks across rounds. (Design decision A2)

Existing seams/contracts to preserve:
- `reassign_judge` (server.js:940-969) stays as the host's manual reassign; update the rotation bookkeeping when the host uses it, so the set stays coherent.
- `select_topic` (server.js:600-650) still requires the current Judge to pick; a skipped/re-assigned Judge is the only change to who that is.
- The `topic_selection` phase gate (rotation only happens here). No timing change (this issue does not add a clock to topic_selection).
- The existing "Judge cannot be swapped once submissions open" rule endures.
- Identity from `socket.data.userId` (auth-bound); never from the payload.

## Done when

- A Judge in `topic_selection` can choose "Skip my turn"; the role moves to a random member who has not already served this cycle.
- Once a member has been the Judge, re-picks skip them until every member has served once; the cycle then resets and persists across rounds.
- If every member skips, the role returns to the first-assigned Judge, who is not offered the pass again (and must pick a topic).
- The host's manual `reassign_judge` still works and keeps the rotation bookkeeping coherent.
- `web-app/e2e/round-phases.spec.js` and `round-deadline.spec.js` pass, plus new judge-skip/rotation tests in the full chromium suite.
- `cd web-app && npm run lint` shows no new errors (23 pre-existing warnings are the baseline).

## Depends on

None.