# A2 Judge "Skip My Turn" — Design Notebook

## Current Position

A Judge who knows they are the Judge cannot decline. The only escape from `topic_selection`
is the host manually reassigning the Judge to another player (`reassign_judge`, server.js:940-969;
host-only, gated on `theme.status === 'topic_selection'`). A Judge who becomes unavailable (or
simply doesn't want to pick) holds the round.

Most recent: participant decision — the Judge should be able to skip their turn as soon as they
know they are the Judge (right after the host or last Judge selects).

## Requested Change

As soon as the Judge learns they are the Judge (topic_selection begins), they may choose to
"skip". Skipping **randomly assigns the Judge role to another member**, with a **fairness
constraint**: everyone must serve as Judge before anyone repeats within a round cycle. So a player
who has already been the Judge this cycle is removed from the re-pick pool until every other
eligible member has had a turn.

This is a random re-roll PLUS a no-repeat-until-all-served rotation guarantee.

## Starting Sources

- `server/server.js` — `reassign_judge` (940-969), `beginRound` czar assignment (244-260), the
  Pick Judge / select-topic flow, `select_topic` (600-650).
- `web-app/src/pages/GroupView.jsx` — the Judge-selection and topic-picker UI; the existing
  Pick Judge modal.
- `web-app/e2e/round-phases.spec.js` — judge-selection tests (170-211).
- `web-app/e2e/round-deadline.spec.js` — judge reassignment tests (304-343).

## Relevant Current Behavior

- `beginRound` (244): picks a random connected player as Judge, unless `forcedCzarUserId` (host
  pick) names one.

Before finalizing this design, delegate a focused trace of the judge-selection / topic_picker /
reassign_judge flow and the client Judge modal, to ground exactly where "skip" attaches and what
"skip" should do (return to a fresh random pick among the other eligible players, or back to the
host's Pick Judge modal).

## Affected Surface

- `server/server.js`: a new inbound event (e.g. `judge_skip`) authorized to the current Judge,
  active only in `topic_selection`, that reassigns the Judge (random among other connected
  players, or re-opens host pick) and broadcasts. Mirrors `reassign_judge` but Judge-authorized
  instead of host-authorized.
- `web-app/src/pages/GroupView.jsx`: a "Skip my turn" control in the Judge's topic-picker; the
  host's Pick Judge modal to re-run if that path is chosen.
- e2e: a judge-skip test.

## External Research

Likely not needed; this is an intra-app control. Confirm only if skip semantics open a
vote/fairness question.

## Candidate Seams and Options

- Random re-roll among the OTHER eligible members, excluding anyone who has ALREADY been the Judge
  this round cycle (this is the participant's explicit rule: "everybody go once before someone can
  do it again"). Chosen.
- Skip → returns to the host's Pick Judge modal (host chooses next). Less consistent with the
  random rotation the participant wants.
- Skip → cycle to the *next* player (round-robin order, not random). The participant wants it
  random ("randomly assign"), so a fixed next-in-roster is not it.

Fairness bookkeeping: track which members have served as Judge in the current round cycle (a set on
the group or per `currentTheme`). When the pool of "not yet judged this cycle" is empty, reset the
cycle (everyone may be picked again). A skipped Judge counts as having served (they were picked,
even if they skipped) so the rotation advances.

## Proposed Delta
TBD after trace; but the guess: a `loopOrder`/`alreadyJudged` set on `currentTheme` (auto-resets per
round via beginRound) or on the group (persists across rounds for the full cycle). Decide whether
the cycle is per-round or spans rounds — the participant's "everybody go once before again" reads as
per-cycle; with one Judge per round, that means the cycle spans R rounds (each R-1 members judge
once before anyone repeats). Confirm this.

## Decisions
Participant: skip → random re-assign to another member, no-repeat-until-all-served.

## Active Change Frontier
1. Does the no-repeat rotation cycle span just one round, or persist across rounds (so a member who
   judged round 1 is skipped until every member judges once)? With one Judge per round, "everybody
   go once before again" implies a group-level cycle across multiple rounds.
2. Skip available: only in `topic_selection` (matching the reassign gate).
3. What if all other members have already served (full cycle)? Reset the rotation.
4. Does a skipped Judge count as "served" for the rotation (so they can't be immediately re-picked)?

## Decision Map
- Status: not needed.

## Best Next Move
Delegate a focused trace of the judge-selection flow + Judge modal, then decide skip semantics.