# A4 Host-Set Round Windows — Change Design

Design notebook: [`.design/a4-round-start-end-time/notebook.md`](../../.design/a4-round-start-end-time/notebook.md)
Source discovery: `docs/discovery/prompted-deep-discovery.md`, findings `f.deadline`, `f.settings`.

## Executive Summary

Today a host controls timing only through group-wide settings: `submissionTime` (hours from topic
selection) and an inert `votingTime` that nothing reads. The proposed change gives each round two
explicit **windows** — a **submission window** and a **voting window** — each with its own
start/end. The host sets each window's length as a **numeric value + unit dropdown**
(minutes/hours/days), and the length is applied relative to the previous phase. The voting window's
end is the A1 voting deadline (the shared close trigger that C8 also relies on).

This fits the application because it reuses the established **evaluate-on-read, no-scheduler**
pattern (persist absolute window instants, evaluate them at the natural moments the round is
handled) that the submission deadline already ships (`server/server.js:198-238`). It also finally
gives the inert `votingTime` setting a real server-side read, and it sequences the round cleanly:
round opens → submission window → voting window → reveal.

## Requested Outcome

- The host can give each round a **submission window** (start + end) and a **voting window**
  (start + end).
- Each window's length is entered as a **numeric value + unit** (minutes/hours/days), applied
  relative to the prior phase — not as a raw absolute datetime (that path needs a "not open yet"
  scheduled state).
- Voting ends on the voting window's end (A1's voting deadline); C8's budget applies until then.
- The existing settings round-trip without a server whitelist; only the invalid values need
  closing so a crafted payload cannot make a window absurdly short or long.

## Relevant Current Behavior

- Timing settings: `submissionTime` (bounded 1-168h, **rejected** on create 722-727 and update
  1001-1006), read only at `advanceIfExpired` re-arm (231) and `select_topic` (634), default 24h.
  `votingTime` is read **0 times** server-side (inert client-side). `autoStart` likewise inert.
- `advanceIfExpired` (198-238) is **submission-only** — the guard `theme.status !== 'submission'`
  (200) means it never ends the voting phase.
- `theme.deadline` is set only at `select_topic` (635) and the re-arm (232); null at `beginRound`
  (273). Voting entry points (212, 930, 1275) and `calculateGroupResults` reveal (456) never
  touch it — there is **no voting deadline today**.
- `start_round`/`start_group` (1094-1187) accept only `{ groupId, czarUserId }` — no timing input.
  `beginRound` seeds `deadline: null`. A host cannot schedule a round start anywhere today.
- **No scheduler** in the server; the design is evaluation-on-read with no `setTimeout`
  (a >24.9-day offset would overflow an in-process timer anyway, a cap the prior design measured).

## Affected Surface

| Area | Change |
|---|---|
| `server/server.js` | Add/read two window lengths (`submissionTime`, and a now-active `votingTime`); set window deadline instants at the right transitions (submission start at round-open, voting start at submission-close); widen `advanceIfExpired` (or add a sibling) so a window's end closes submission → voting → reveal (this overlaps A1) |
| `beginRound` / `start_round` / `start_group` | Accept the window settings and seed the first window's deadline |
| Settings validation | Validate the new numeric+unit values (extend `isValidSubmissionTime`; add for the voting window); reject absurd windows as today's `isValidSubmissionTime` rejects out-of-range values |
| `web-app/src/pages/CreateGroup.jsx`, `GroupView.jsx` | Add a numeric + unit dropdown (minutes/hours/days) for each window in the Jury/Timing sections; display the active window in the countdown |
| e2e | Window-expiry tests (submission and voting close on their end); a unit-conversion test; the existing round-deadline validation tests updated for the two windows |

## External Findings That Shaped the Design

No web search was available this pass (the search endpoint was misconfigured), so this design
relies on grounded code evidence and the participant's explicit representation choice. The
numeric + unit dropdown matches the codebase's existing `min`/`max` numeric inputs and needs no
external UX research to be internally consistent. (If a "modern" pattern is desired later, it can
be sourced once web search is restored — it does not change the underlying window model.)

## Options and Candidate Seams

- **Option A — numeric + unit dropdown per window (chosen).** Each of submission and voting is a
  value + unit (minutes/hours/days), relative to the prior phase. Simple, matches the existing
  numeric inputs, needs no scheduled "not open yet" state beyond today's deadline.
- **Option B — absolute start/end datetime.** Precise but requires a "round not yet open"
  scheduled state, absolute-time validation, and more UI surface. Rejected for now; can be an
  additive layer if a host wants fixed calendar scheduling later.
- **Seam — extend the existing deadline machinery.** Reuse `theme.deadline` (persisted,
  evaluate-on-read) for each window's end, set at the right transition. Widen `advanceIfExpired`
  so it also closes the voting window (shared with A1), since the voting window's end IS the A1
  voting deadline. This keeps one timing authority rather than adding a scheduler.

## Proposed Delta

1. Read `votingTime` server-side for the first time (it already round-trips via the settings
   merge at server.js:714/1009). Validate it with the same reject pattern as `submissionTime`.
2. Sequence the windows on the round: set the submission window end when the round/submission
   phase opens; on its close, open the voting window and set its end; on the voting window's end,
   run `calculateGroupResults` → reveal (this is exactly A1).
3. Widen `advanceIfExpired` (or add the sibling) to honor both windows' deadlines at the natural
   evaluation moments (get/join/submit/start + the client nudge). The client countdown already
   reads `theme.deadline` generically (GroupView.jsx:128), so it counts whichever window is active
   with no client scheduling change.
4. Update the Create Group and Rules-editor timing sections to the numeric + unit dropdowns (for
   `submissionTime` and the now-active `votingTime`), and the Overview to render the active window
   and its countdown.

## Transition and Coexistence

Rounds in flight when deployed are picked up at the next evaluation moment; the window end is a
persisted absolute instant, so the evaluate-on-read model handles it with no migration and no
scheduler. Existing groups inherit default window lengths (24h) on first read. The `votingTime`
field, previously inert, begins to act — a behavior change covered by the e2e updates.

## Decisions

| Decision | Choice | Confidence | Reason to reopen |
|---|---|---|---|
| Two windows | Separate submission (start/end) and voting (start/end) | High — participant decided | If a host wants one combined timing later |
| Representation | Numeric value + unit dropdown per window | High — participant decided | A "modern" pattern can be sourced once web search returns |
| Voting close | Voting window end = A1 voting deadline = C8's close trigger | High | Shared with A1; deliver together |
| Scheduled start | No absolute datetime scheduling now | Medium | An additive absolute-time layer is possible later |
| Validation | Extend the reject pattern to the new window values | High | Mirrors `isValidSubmissionTime` |

## Research and Prototype Findings

No web search this pass. No prototype needed — the deadline machinery (evaluate-on-read on a
persisted instant) is already shipped and tested for the submission phase; this change reuses it
for the voting window. The only net-new server behavior is reading `votingTime` and widening the
expiry check to close voting (which is A1).

## Remaining Design Questions

1. **Window-unit bounds.** Today 1-168h. With units (minutes/hours/days), confirm the min/max the
   server should reject (e.g. 1 minute to, say, 30 days) and keep the reject-not-clamp pattern.
2. **Which "end" a host references.** This design assumes submission-end opens voting; confirm the
   two windows' exact relative anchor (submission ends → voting starts immediately).
3. **Inventory of the inert settings.** `autoStart`, `enableChat`, `enableSongPreview`,
   `showVoterIdentity`, `totalRounds`, `maxPlayers` remain inert and are out of scope; this change
   touches only `submissionTime` + `votingTime`.