# A4 Host-Set Round Start/End Time — Design Notebook

## Current Position

The host sets `submissionTime` (hours) at group creation; the submission window runs for that
many hours from when the topic is chosen (`select_topic` sets `theme.deadline`, server.js:635).
There is no way to schedule a round start, and the end is a duration, not an absolute time.

Most recent: participant decision — the host should be able to pick a start time AND an end time
for each round.

## Requested Change

Replace the single "submission = N hours from topic pick" duration with **two explicit windows**,
each a start and an end time:
- **Submission window:** start time + end time.
- **Voting window:** start time + end time.

This supersedes the earlier "start and end for the whole round" reading. The voting window's end
is the A1 voting deadline (A1/A4 converge). The representation of each window (numeric value +
unit dropdown vs. absolute datetime vs. another pattern) is an open decision the participant is
open to suggestion on.

## Trace findings (A4 timing agent)
- `submissionTime` bounded 1-168h, REJECTED (not clamped) in create (722-727) and update
  (1001-1006). Server reads only at 231 (re-arm) and 634 (select_topic), `|| 24`.
- `votingTime` and `autoStart` read 0 times server-side (inert client-side).
- `advanceIfExpired` (198-238) is submission-only (guard at 200).
- `theme.deadline` set ONLY at 635 (select_topic) and 232 (re-arm); null at beginRound (273).
  Voting entry (212/930/1275) and reveal (456) never touch it — NO voting deadline today.
- `start_round`/`start_group` (1094-1187) accept only `{groupId, czarUserId}` — no timing args.
- NO scheduler: a future start/end must be a persisted absolute instant evaluated at natural
  moments + client nudge/poll (the established evaluate-on-read seam), not setTimeout (the
  24.9-day overflow cap). Validation of absolute instants (start<end, future) is new territory.

## Starting Sources

- `server/server.js` — `select_topic` deadline (600-650, deadilne at 635), `advanceIfExpired`
  (198-238), `submissionTime` read sites (231, 529, 722-727), create/update validation.
- `web-app/src/pages/CreateGroup.jsx` — timing section (submissionTime input ~460-470).
- `web-app/src/pages/GroupView.jsx` — editing and Overview display of submissionTime (~1483, 1625).
- `web-app/e2e/round-deadline.spec.js` — window validation (346-395).
- `docs/design/round-stall-change-design.md` — current deadline semantics.
- `docs/design/a1-voting-deadline-change-design.md` (sibling) — the voting-window model.

## Relevant Current Behavior

- `submissionTime` is the only timing setting; validated 1-168h (create/update).
- `theme.deadline = now + submissionTime hours` set at `select_topic` (635).
- The deadline is a persisted absolute instant; `advanceIfExpired` evaluates it at natural
  moments (no scheduler).

## Affected Surface

- Timing model: add start-time semantics (round does not open until START even if started
  earlier) and end-time (absolute close) alongside or replacing the duration. Decide whether
  submissionTime is replaced by an explicit end datetime, or whether start+end are added.
- `seed_timer`/evaluate points: `advanceIfExpired` or a sibling must not open voting before
  START and must close at END.
- Client: date/time pickers in CreateGroup + Rules editor; countdown renders a scheduled-start
  state ("starts in X") when before START.
- Settings/data: new fields (e.g. `roundStartAt`, `roundEndAt`) or replaced `submissionTime`.
  Round-trips via the un-whitelisted merge; add validation.
- Tests: round-deadline window validation; scheduled-start test.

## External Research
Not needed.

## Candidate Seams and Options
- Replace `submissionTime` entirely with an absolute end datetime (+ optional start). Sov simplist
  but breaks existing groups/settings.
- Add start+end datetimes read in addition to the current per-phase deadline; `submissionTime`
  becomes a default/legacy. Coexistence.
- Interpret "start and end" as the submit window only (submission open/close) vs. the whole round
  (including a scheduled voting window per A1). Confirm with participant which phases the
  start/end govern.

## Proposed Delta

Two windows, each a start + end time:
- **Submission window:** start + end.
- **Voting window:** start + end (its end is the A1 voting deadline).

Representation (participant): for each window, a **numeric length + a unit dropdown
(minutes/hours/days)** selecting the window's duration relative to the previous phase. This uses
the existing evaluate-on-read/no-scheduler model (persist the window instants on the group/round,
evaluate at natural moments + client nudge) rather than setTimeout.

- `submissionTime` and `votingTime` remain the per-window lengths (hours default), each now with a
  user-chosen unit; both read server-side for the first time (`votingTime` currently inert).
- Add server validation for the new units/values (mirror the 1-168h reject, extended/documented
  for absolute window semantics; absolute start<end if absolute times are later added).
- The two windows sequence in the round lifecycle: round opens → submission window → voting window
  → reveal. Each window's end (absolute instant) closes it via the evaluate-on-read seam.

## Decisions
Participant: two separate windows (submission start/end, voting start/end); representation is a
numeric value + unit dropdown per window. Confirmed this pass.

Cross-pass: A4's voting end IS the A1 voting deadline (shared close trigger, also C8's close).

## Active Change Frontier
1. Do START and END govern the submission phase only, or the whole round (incl. voting via A1)?
2. Replace `submissionTime` or coexist with it?
3. How to represent "round opens at START" with no scheduler — evaluation-on-read already
   handles END; "not open yet" needs the phase to wait until START.

## Decision Map
- Status: not needed.

## Best Next Move
Confirm participant intent on frontier Q1 (which phases start/end govern), then trace the
submission/voting timing to define the scheduled state.