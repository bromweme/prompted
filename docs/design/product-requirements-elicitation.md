# Product requirements elicited from play-test feedback

This note records product decisions gathered from the participant after play-testing.
It is requirements material for a future `/design:change-design` pass — it is **not** an
implementation plan and **not** an issue graph change. Each item names a product decision
and the current behavior it would replace or confirm.

These were answered area by area in a single elicitation session. Where the participant's
answer confirmed current behavior, it is marked "confirm". Where it changes behavior, it is
marked "change". Unanswered questions from the original checklist are listed at the end.

## A. Round timing & pacing

### A1 — Voting deadline (change)
**Decision:** If the voting time expires without everyone voting, complete the round as usual;
players who did not vote miss that round. The round must never deadlock waiting on a straggler.

**Current behavior:** Voting has no deadline. The round waits for votes; there is no expiry
path that closes voting and reveals the result. (`advanceIfExpired` only handles the submission
phase.)

### A2 — Judge "skip my turn" (change)
**Decision:** As soon as a Judge knows they are the Judge (right after the host or the last
Judge selects), the Judge gets the option to skip their turn. This lets a Judge hand back or
pass rather than being forced to pick a topic.

**Current behavior:** The only escape for a stuck Judge is the host manually reassigning the
Judge role to someone else (`reassign_judge`, only while in `topic_selection`). The Judge
cannot decline on their own.

### A3 — No-submission round (confirm)
**Decision:** If the round completes (restarts) three times without anyone submitting, notify
the host and keep the round waiting. The host then decides manually (start over, or the
existing behavior). The group is not stuck; it awaits host action.

**Current behavior:** `MAX_AUTO_REARMS = 3`. After three empty restarts the server sets
`rearmExhausted` and sends the host a `round_stalled` notice, keeping the round waiting for a
host to start over. Matches the decision.

### A4 — Host sets a start and end time per round (change)
**Decision:** The host should be able to pick a start time and an end time for each round,
rather than a fixed submission window measured from round start.

**Current behavior:** The group setting is `submissionTime` (hours), applied from when the
submission phase begins. There is no explicit round start/end time selection.

## B. Host & presence

### B5 — Vote on a new host when the host abandons (change)
**Decision:** When the host has been gone more than a month, remaining members get the option
to (a) leave the group, or (b) vote on a new host. A **majority vote among current members**
selects the new host, who becomes the sole host. This only applies when the host is inactive
for the long period; it is not available while the host is around or briefly disconnected.

**Current behavior:** The host is permanent. `leave_group` refuses the host (REP-GL1-1), and
there is no path for members to replace a vanished host. A group whose host stops returning is
unmanageable and undeletable by anyone else. This decision is the legitimate escape hatch for
that rule.

### B6 — Do not change the host on transient disconnect (confirm)
**Decision:** A host dropping mid-round and returning resumes as host. Do not promote anyone on
a short timeout. Host absence is expected and common; gameplay must continue regardless.

**Current behavior:** The disconnect handler only flips `connected = false`; the host keeps the
role. No host timeout exists. Matches the decision.

### B7 — Host and Judge are distinct roles (confirm naming)
**Decision:** The Judge (formerly "round leader") is different from the host. The host creates
the game and picks the Judge. The Judge is a rotating per-round title; the host is the
permanent group creator.

**Current behavior:** Two separate concepts exist in the code (`group.host` vs the per-round
Judge/`currentTheme.czarId`). Matches the decision.

## C. Voting semantics

### C8 — Per-round vote budget (change)
**Decision (new model):** The host specifies how many votes each person has **per round**.
A downvote deducts from that round's budget. After the round, each person's vote budget resets
so they can vote fully on the next round.

**Current behavior:** One vote per player per round, each worth `0..maxJuryPoints`, with an
ungated `isDownvote` flag and an optional `downvoteCost` also docked from the player's lifetime
`score`. `create_group`/voting do not model a per-round vote budget or a reset.

**Interaction:** `allowDownvotes` is currently client-only (not enforced server-side). Under
the new budget model, enforcement and a per-round reset need design.

## Open — not yet answered in this session

- B5 exact inactivity definition ("gone more than a month") — what marks a month precisely
  (last seen timestamp? no connects in 30 days?).
- C8 budget mechanics: are multiple votes cast per submission or spread across distinct
  submissions? Can a player spend the whole budget on one entry?
- C7 `allowDownvotes` default (on/off) and enforcement semantics under the new budget.
- C10 tie-breaking acceptability across a multi-vote budget.
- D group limits: enforce round-league `totalRounds` end of season, and `maxPlayers`.
- D rejoin behavior across an active round: is a returning leaver locked out of the active
  round, or only the next one?
</content>

Note: the un-answered items above (B5 exact interval, C8 mechanics, C7, C10, D) are carried
forward because the participant said they would get to the rest of the questions later.