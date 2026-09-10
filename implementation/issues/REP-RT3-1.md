# REP-RT3-1 — A Judge assigned via a skip (or a host hand-pick) is never recorded in the served set, breaking no-repeat fairness

- **Status:** Implemented (repair wave) — awaiting closure review
- **Priority:** high
- **Guarantee to restore:** The RT-3 no-repeat guarantee — once a member has been the Judge, future re-picks skip them until every member has served once; only then does the cycle reset. A member must never be re-drafted as Judge (via a skip re-pick or a host hand-pick) while an unserved member has never held the role.
- **Blocks:** `RT-3` (keeps the Judge-skip rotation feature from reaching `Done`)
- **Depends on:** none (fixes a defect in the Wave 7 `RT-3` implementation, commit `6c428d0`)

## Failed behavior

`recordJudgeServed` (`server/server.js:200-210`) — the only helper that writes a member into the group-level `judgedThisCycle` served set — is called from exactly **one** place: `beginRound` (`server.js:470`), which records only the **first-assigned** leader. Two assignment paths never record the actual Judge:

1. **Skip-assign** (`judge_skip`, `server.js:1229-1280`): when the current Judge skips, the rotation picks `next` from the not-yet-served pool and sets `theme.czarId = next.userId` (line 1266), but line 1267 assigns `group.judgedThisCycle = currentServed` — and `currentServed` contains only the **skipper** (`currentJudgeId`), never the newly-assigned `next.userId`. So the member who is skipped-onto and then picks a topic (or is otherwise the round's Judge) is invisible to the served set.
2. **Host hand-pick** (`reassign_judge`, `server.js:1187-1219`): sets `theme.czarId = next.userId` (line 1212) and clears `judgeMustPlay`, but never calls `recordJudgeServed` nor adds `next.userId` to `judgedThisCycle`.

## Trigger

A group of 4 (host + A, B, C) where a skip-assigned Judge completes a round:

- **Round 1:** first-assigned A (recorded: served = {A}); A skips → B is picked as Judge (served stays {A}); B picks a topic and round 1 completes. After round 1, `judgedThisCycle === [A]` — B, the round's actual Judge, is **not** recorded.
- **Round 2:** first-assigned C (recorded: served = {A, C}); C skips → the skip pool (`server.js:1263`) excludes only {A, C}, so it is {B, D}; the random pick may land on **B**. B is Judge again (round 1 + round 2) while D has never served.

This reproduces via the normal UI in a group where at least one initially-assigned Judge skips and the replacement then plays. The existing `judge-skip.spec.js` exercises only forced first-assigned skip chains (in which every member ends up a skipper and so gets recorded), so it never hits this path and does not fail.

## Affected flow

1. `beginRound` records only the first-assigned Judge (`server.js:470`).
2. `judge_skip`'s non-empty pool branch assigns `theme.czarId = next.userId` but stores only the skipper in `judgeThisCycle` (`server.js:1266-1267`), leaving the skipped-onto Judge out of the cycle set.
3. `reassign_judge` hands the role to `next` in `judgeThisCycle` (`server.js:1212`) without recording them.
4. Because such Judges are invisible to `judgeThisCycle`, the next skip re-pick (`server.js:1263`) treats them as unserved and may re-draft them while an unserved member never gets a turn.
5. Observable failure: a member judges twice before everyone has judged once, violating the RT-3 done condition (`implementation/issues/RT-3.md:44-45`) and the product business rule.

Components that must change: `server/server.js` — record a member in the served set at the moment they actually GOVERN the Judge role, i.e. when they **play** (select a topic in `select_topic`) or **decline** (skip in `judge_skip`, already recorded). Do NOT record at the mere moment of assignment. Reuse `recordJudgeServed` for the reset-when-full + drop-departed semantics. The change-reviewer did not find the defect (it reasoned the served-set line 1263 excludes all served members, missing that skipped-onto Judges are invisible to the set); the adversarial reviewer identified it, and the initial spec's "record at assignment" direction was corrected during the repair because it made the required full-skip-revert unreachable.

## Repair requirements

- **Record "served" when the member exercises the Judge role, by playing or by declining — never at the moment they are merely assigned.**
- Record in `select_topic` (server.js ~795-844): once the Judge picks a topic (i.e. commits to running the round, before/after `theme.status = 'submission'`), call `recordJudgeServed(group, theme.czarId)`. This captures the skip-assigned-then-plays Judge and the host-hand-picked-then-plays Judge.
- Record the skippers in `judge_skip` (already present via `currentServed`) — **keep that unchanged**; do NOT add `theme` newly-assigned `next.userId` to the served set at assignment time.
- `beginRound` already records the first-assigned Judge (server.js:470) — keep it.
- `reassign_judge` (host hand-pick) does NOT itself record the target; the hand-picked Judge is recorded when they play (`select_topic`) or skip. This keeps the set from filling on assignment and preserves the full-skip-revert.
- The full-skip exhaust branch (pool empty → revert to first-assigned Judge with `judgeMustPlay = true`, reset the cycle) is **correct** and must stay unchanged and reachable.
- The three existing judge-skip behaviors — skip moves to a non-served member; no-repeat; full-skip reverts to the first Judge who must play — must keep passing with their existing assertions UNedited, including the cross-round persistence test. Do not weaken or delete any existing assertion.
- Do not regress HG-1 (host election), vote budget, no-early-reveal, leave/delete, or the host-leave guard.

## Done when

- A skip-assigned Judge who then plays a round is recorded in `judgedThisCycle` (via `select_topic`), and a later skip re-pick never re-drafts them before an unserved member gets a turn (the 4-player scenario above is prevented).
- A host `reassign_judge` hand-pick whose target then plays is recorded (via `select_topic`), so it is excluded from future skip re-picks until the cycle resets; the hand-pick itself does not need to advance the cycle.
- The full-skip-revert done-condition stays reachable and correct: when everyone declines and the pool is empty, the role reverts to the first-assigned Judge with `judgeMustPlay = true` (existing test 3 passes unchanged).
- A focused regression (socket-level e2e) covers the exact gap the closure review flagged: a member who became Judge via a prior skip and played, then a later round where another member's skip re-pick must **not** re-select them while an unserved member remains. The existing tests in `judge-skip.spec.js` all keep passing unchanged.
- The full chromium suite still passes (100 tests before this repair; the added regression may add one test) and `cd web-app && npm run lint` stays at no new errors (23 pre-existing baseline).

## Depends on

None.