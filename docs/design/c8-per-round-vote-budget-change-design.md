# C8 Per-Round Vote Budget — Change Design

## Executive Summary

Replace the current "one vote per player per round" model with a **host-set per-round total point
budget** per player (cumulative voting). Each player has a budget of points to spend across votes
on submissions in a round; a downvote spends from that budget; the budget resets at the start of
the next round. Voting closes on a **voting deadline** (a fixed timed phase) rather than when
everyone has voted. A downvote spends only from the round budget and no longer also docks the
voter's lifetime score.

**Chosen seam:** the server `cast_vote` gate plus a new per-round used-points counter on
`group.currentTheme`. This is the minimal, schema-compatible seam: the existing tally, scoring
winner-resolution, and history layers already tolerate multiple votes per player — only the
one-vote admission gate (server.js:1304) and the immediate-reveal completion predicate
(server.js:1365) need to change. New host settings round-trip through the existing un-whitelisted
settings merge, so no serialization pipeline change is required.

## Requested Outcome

- The host sets how many **points** each player may spend per round (a per-round budget).
- Each vote spends a chosen point value on a submission. `maxJuryPoints` still caps any single
  vote's value.
- A downvote spends `downvoteCost` from the round budget (asymmetric cost). A downvote does not
  separately reduce the voter's lifetime score.
- The budget resets at the START of the next round — everyone can vote fully each round.
- Whether a player may concentrate the whole budget on one submission is a **host rule**.
- `allowDownvotes` (allow/disallow downvotes) is **enforced server-side** (it is client-only
  today): a crafted downvote is rejected when the group forbids downvotes.
- Voting ends on a voting deadline; no early reveal.

## Relevant Current Behavior

- `cast_vote` (server.js:1288-1370) enforces one vote per player per round via
  `theme.votes.some(v => v.voterUserId === userId)` (server.js:1304) — rejects any second vote.
  Each vote is `{ voterUserId, submissionId, points, isDownvote, comment }` (1348-1354).
- Round completes immediately when `theme.votes.length >= eligibleVoters.length`
  (server.js:1365), where `eligibleVoters` filters out players with no legal target (the
  two-player deadlock guard). An immediate reveal.
- `calculateGroupResults` (server.js:393-480) tallies points per submission, resolves the winner
  (public override -> Judge selection -> popular vote), awards `czarPoints`, and docks a
  downvoter's lifetime `score -= downvoteCost` (448-449) regardless of outcome.
- `userVote` is **purely client-local optimistic state** (GroupView.jsx:88, set at 569) that gates
  the whole vote panel (1040) and disables all submissions (1015). The client gets no
  "remaining budget" field from the server today.
- Scoring settings live on `group.settings`, merged with no allow-list at create (server.js:714)
  and update (server.js:1009), so unknown keys already persist. `allowDownvotes` appears **zero
  times** in server.js — it is read only client-side.
- Per-round state lives on `group.currentTheme`, replaced wholesale each round by `beginRound`
  (server.js:260), so per-round fields auto-reset.

## Affected Surface

- **Server** (`server/server.js`): `cast_vote` gate; new per-round used-points counter on
  `currentTheme`; removal of the immediate-reveal completion predicate and the downvoter score
  docking (448-449); server enforcement of `allowDownvotes`; read/clamp the new budget +
  concentration settings in the create/update validation.
- **Client** (`web-app/src/pages/GroupView.jsx`, `CreateGroup.jsx`, `Dashboard.jsx`): replace the
  boolean `userVote` with a remaining-points model; rework the `1040` gate and `1015` disabling;
  add the budget + concentration settings inputs to the Jury sections and the normalize defaults.
- **Contracts**: a new "remaining/used budget" field in the `group_updated`/`group_details`/
  `group_joined` payloads; new settings keys. No serializer change (settings spread freely).
- **Tests** (`web-app/e2e/round-phases.spec.js`): the "cast once per player to complete voting"
  loops (404-408, 438-441, 487-488) and Phase-3 assertions (410, 444) break and must be reworked
  to the timed-close model. Self-vote UI (271-294) and server self-vote (296-381) survive.
- **Qualities**: fairness (budget equity per round), deadlock protection (time closes voting),
  authorization (downvote enforcement).
- **Owner**: the whole repo (server + web-app + e2e).

## External Findings That Shaped the Design

- This is **cumulative / dot voting** with a host-set budget — established, low-risk. Partial
  spending and concentration (plumping) are both recognized behaviors
  ([Wikipedia: Cumulative voting](https://en.wikipedia.org/wiki/Cumulative_voting)). The closest
  song-contest analog is [Eurovision](https://en.wikipedia.org/wiki/Voting_at_the_Eurovision_Song_Contest),
  which grants a fixed per-show point budget that resets.
- **Downvotes should share the round budget and carry asymmetric cost.**
  [Stack Overflow's vote-down guide](https://stackoverflow.com/help/privileges/vote-down) shares
  one daily pool between up/down and taxes answer-downvotes — matches spending budget and the
  existing `downvoteCost`.
- **Reset at round start, no banking**: dominant convention in cumulative voting, Eurovision,
  and Stack Overflow's daily pool — unspent budget lapses. Matches the participant's "reset at
  next round start."
- Watch for **plumping** (whole budget on one) and **vote-splitting** (spreading can deny a
  favorite). The participant chose to make concentration a host rule rather than fix a model.
- Research caveat: `web_search` was unavailable; findings were gathered via `web_fetch` against
  authoritative URLs (Wikipedia, Stack Overflow).

## Options and Candidate Seams

- **Seam A — budget gate + used-points counter.** Replace the one-vote scan (1304) with a
  per-player used-points check. Track used points as a counter on `currentTheme` (auto-resets) vs.
  deriving by summing `theme.votes`. Chosen: counter on `currentTheme` (simpler, matches reset).
- **Seam B — completion.** B1 full-budget spend, B2 at-least-one-vote floor, B3 host-closes,
  deadline. Chosen (participant): **deadline closes voting — no early reveal**. This removes the
  fragile `1365` immediate-reveal path entirely and avoids deadlock (time ends voting). Depends on
  A1 (voting deadline, separate design).
- **Seam C — settings.** Add the budget amount + concentration toggle. Persist via the existing
  un-whitelisted merge; clamp in create/update. `downvoteCost` already exists.
- **Seam D — client budget model.** Replace boolean `userVote` with a server-sourced remaining
  budget. The optimistic local flag cannot distinguish "budget exhausted" from "mid-budget" once
  multiple votes are possible, so a server-delivered field is required.
- **Seam E — downvote economics.** Downvote spends `downvoteCost` from the round budget; the
  lifetime score docking (448-449) is removed (participant: only spend from budget).

## Proposed Delta

**Server `cast_vote`:** change the admission gate from a one-vote scan to a per-player
used-points check against the host-set budget (reject if used + new > budget). Add a
`currentTheme.voteBudgetUsed` counter. Reject a downvote server-side when `allowDownvotes` is
false (new enforcement).

**Server completion:** remove the immediate-reveal path (server.js:1365 and the reveal branch on
`calculateGroupResults` from all-voted). Voting closes on its deadline (A1). `calculateGroupResults`
runs at close.

**Server scoring:** remove the downvoter lifetime score docking (448-449). Winner tally is
unchanged.

**Per-round state:** `voteBudgetUsed` on `currentTheme` auto-resets each round via `beginRound`.

**Settings:** add per-round budget amount and a concentration allowed toggle. Round-trip freely;
clamp in create/update. `downvoteCost` unchanged.

**Client:** replace `userVote` with a server-sourced remaining-points value; rework the panel gate
and submission disabling so a player can keep voting while budget remains; reset to full budget at
round start. Add the settings inputs to the Jury sections and normalize defaults.

**Contracts:** add a remaining/used budget field and the two settings keys. No serializer change.

**Tests:** rework the "cast once to complete" loops to the timed-close model; add a downvote-budget
test and a server `allowDownvotes`-enforcement test.

## Transition and Coexistence

No long coexistence needed — this is a settings + per-round-counter change, schema-compatible.
In-flight rounds: read the budget per-cast from current settings, so a host changing the budget
mid-round affects the rest of that round (simplest, acceptable). Downvote-score removal is
immediate (no data migration; scores simply stop docking). Budget defaults apply to new groups;
existing groups inherit a valid default on first read.

## Decisions

- **Total point budget per round (participant):** the core model; budget resets each round.
- **Voting ends on the deadline (participant):** fixed timed phase, no early reveal. High
  confidence; removes an existing fast path (e2e rework) and depends on A1.
- **Downvotes spend only from the budget (participant):** remove lifetime score docking; resolves
  finding `f.downvote` as a deliberate one-cost choice.
- **Concentration is a host rule (participant).** Default value is a remaining product-default
  question.
- **Server-enforce `allowDownvotes`:** new behavior; the e2e suite should cover a crafted downvote
  when forbidden.
- **Used-points on `currentTheme`:** design-settled from the reset semantics and the server trace.

Reopen if: a fixed voting phase feels slow in play (revisit early-reveal); the downvote budget cost
feels too weak/strong (budget and `downvoteCost` are settings, not structural).

## Research and Prototype Findings

Cumulative/dot-voting precedent (budget reset, plumping, vote-splitting, shared up/down pool) is
the strongest guide. No prototype required — the code trace confirms the tally/scoring layers
already support multiple votes per player; the change is concentrated in the gate, the completion
path, the setting surface, and the client's remaining-budget model. The client "remaining budget"
field is the one net-new contract.

## Remaining Design Questions

1. **Voting-deadline mechanism (A1).** C8 depends on the deadline being the close trigger but does
   not design the clock. A1 is the next design pass.
2. **Budget + concentration defaults.** Suggested default budget ~ a small multiple of
   `maxJuryPoints`; concentration on/off default is a product-default choice.
3. **Concentration under multi-vote.** The existing own-submission rule (a player cannot vote for
   their own submission) endures regardless of the concentration setting.

---

Session synthesis (notebook + report):
- Notebook: `.design/c8-per-round-vote-budget/notebook.md`
- Report: `docs/design/c8-per-round-vote-budget-change-design.md` (this file)