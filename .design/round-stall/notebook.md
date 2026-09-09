# Round Stall Design Notebook

## Current Position

The strongest design is **a persisted deadline evaluated at natural moments, with no scheduler**. The server gains one idempotent function that asks "has this round's deadline passed?" and is called wherever the round is already being touched, plus one client nudge when the on-screen countdown reaches zero. The server always re-checks its own clock, so the client is a trigger and never an authority.

Most recent change: rejected the in-process timer seam on two pieces of measured evidence — `submissionTime` defaults to 24 hours and is unvalidated on the wire, and Node clamps any delay over 24.9 days to 1 ms and fires immediately.

## Requested Change

A round must always be able to finish.

**Scenario 1 — submissions are in, one player is missing.** Today the submission phase ends only when every connected non-Judge player has submitted. One member who never returns holds the round open forever while the interface counts down to zero and then sits there. Desired: at the deadline, move to voting with the submissions that arrived.

**Scenario 2 — nobody submitted at all.** Desired (participant decision): tell the host the time ran out, and restart the round with **the same Judge and the same topic**.

**Scenario 3 — the Judge never picks a topic.** A host may assign the Judge role to an offline player, and only the Judge can leave `topic_selection`. There is no deadline in this phase at all. Desired: the round is recoverable without waiting for that person.

## Starting Sources

- `docs/discovery/prompted-deep-discovery.md` — finding `f.deadline`, the highest-priority correctness finding
- `docs/discovery/prompted-assets/knowledge-base/application-model.json` — evidence `ev.deadline.set`, `ev.deadline.unenforced`, `ev.submission.advance`, `ev.beginround.pool`
- `server/server.js` — the authority for the round lifecycle
- `web-app/src/pages/GroupView.jsx` — the countdown the player watches
- `web-app/src/pages/CreateGroup.jsx` — where `submissionTime` is chosen
- Participant decision, this session: the zero-submission branch restarts with the same Judge and topic

## Relevant Current Behavior

**The deadline is written once and never read.**
`select_topic` sets it (`server/server.js:528-530`):

```js
const submissionHours = group.settings.submissionTime || 24;
theme.deadline = new Date(Date.now() + submissionHours * 60 * 60 * 1000).toISOString();
```

Nothing else in the server reads `theme.deadline`. A grep for `setTimeout` and `setInterval` across `server/server.js` returns **no matches** — the server has no scheduler of any kind.

**The only exit from the submission phase** (`server/server.js:949-951`):

```js
const eligiblePlayers = group.players.filter(p => p.connected !== false && p.userId !== theme.czarId);
if (eligiblePlayers.length > 0 && theme.submissions.length >= eligiblePlayers.length) {
  theme.status = 'voting';
}
```

Note this counts **connected** players, so a player who disconnects mid-phase shrinks the bar. That is a partial mitigation today, but it does not help when the player stays connected and simply never submits, and it does not help at all when a player's socket lingers.

**The client counts down and then does nothing** (`web-app/src/pages/GroupView.jsx:113-131`): a one-second interval computes the remaining time, and at zero it calls `setTimeRemaining(0)` and `clearInterval`. The player watches 00:00 and waits.

**`topic_selection` has no deadline.** `beginRound` sets `deadline: null` (`server/server.js:178-180`) with a comment explaining the clock deliberately starts when the topic is chosen, so time spent choosing is not taken from the players' window. Sound reasoning, but it means the topic-selection stall cannot be solved by a deadline check without introducing a new one.

**The Judge may be offline.** `beginRound` prefers connected players for a random pick, but a host-forced Judge is looked up with no connected check (`server/server.js:158-160`).

## Affected Surface

| Area | Effect |
|---|---|
| `server/server.js` — `select_topic` | Deadline continues to be set here; add server-side bounds on `submissionTime` |
| `server/server.js` — `submit_video` | Existing auto-advance stays; expiry check added alongside |
| `server/server.js` — `get_group`, `join_group` | Become evaluation points |
| `server/server.js` — new `advanceIfExpired(group)` | New shared responsibility |
| `server/server.js` — new inbound event | Client nudge when its countdown hits zero |
| `broadcastGroup` payload | Gains a per-player notice so the host learns a round restarted |
| `web-app/src/pages/GroupView.jsx` | Countdown emits the nudge at zero instead of stopping silently; renders the notice |
| Persisted group blob | No schema change. `deadline` already exists and already persists |
| Tests | New coverage for both expiry branches; existing deadline assertion at `game-loop.spec.js:120` still holds |
| Owners | Host gains a notification and a recovery path; players gain a round that ends |

**Not affected:** voting, scoring, reveal, history, identity, topic ownership, the YouTube path. `votingTime` is collected but inert and stays out of scope.

## External Research

**Q: Can an in-process timer carry a 24-hour submission window reliably?**

Measured on this machine (Node v26.5.0):

```
submissionTime default 24h = 86400000 ms
TIMEOUT_MAX (2^31-1)       = 2147483647 ms = 24.9 days
24h fits in one setTimeout : true
delay of 2^31 ms schedules as _idleTimeout: 1   (fires immediately)
```

Node raises `TimeoutOverflowWarning` and clamps to 1 ms for any delay above 2^31-1.

**Code implication.** 24 hours fits, so the overflow is not reachable through the wizard, which bounds the input to 168 hours. But that bound is `min="1" max="168"` on an HTML input (`web-app/src/pages/CreateGroup.jsx:465-466`) and **the server never validates `submissionTime`** — `server/server.js:529` simply reads `group.settings.submissionTime || 24`. A crafted `create_group` payload can set any number. Today that is nearly harmless because nothing reads the deadline. Under a timer seam it becomes "round advances instantly", which is a worse failure than the stall being fixed.

**Remaining uncertainty:** none that changes the design. This finding removes an option rather than creating one.

## Candidate Seams and Options

### A — In-process timer per round

Attach in `select_topic`: `setTimeout` for the remaining window, firing a handler that advances the phase.

- **Against:** does not survive a restart, and the default window is 24 hours, so a restart during a normal round silently loses the guarantee. Requires a re-arm sweep at boot, which is the sweep from option C plus a scheduler. Unvalidated `submissionTime` makes overflow reachable. Adds the first scheduler to a server that has none.
- **Would be strengthened by:** short windows (minutes) and a process that never restarts. Neither holds.

### B — Host force-advance only

A host-only "Close submissions now" control.

- **Against:** does not fix the scenario. It replaces an absent player with an absent host as the thing that blocks the round, and the discovery already found that the host role cannot be transferred (`f.host`), so an absent host is a real and unrecoverable case.
- **Keep as:** a useful addition, not a solution.

### C — Persisted deadline, evaluated at natural moments *(chosen)*

One idempotent `advanceIfExpired(group)` called wherever the round is already handled.

- **For:** the deadline is already persisted inside the group blob, so this is stateless and restart-safe with no new state. It matches the existing architecture, in which the server decides and the client asks. No scheduler.
- **Against on its own:** if every player is simply sitting on the round view and nobody interacts, nothing triggers the check.

### D — C plus a client nudge *(chosen, as the completion of C)*

The client already runs a countdown that reaches zero. At zero it emits one event; the server re-checks its own clock and acts only if the deadline genuinely passed.

- **For:** closes C's only real gap. The client is a trigger, never an authority, so a lying or skewed client achieves nothing — the same posture the codebase already takes everywhere else.
- **Cost:** one new inbound event, which must be rate-limited like every other (the existing token bucket already covers it).

## Proposed Delta

**Structure.** One new server function:

```
advanceIfExpired(group) -> boolean   // did anything change?
  no currentTheme, or status !== 'submission', or no deadline  -> false
  Date.now() < deadline                                        -> false
  submissions.length >= 1  -> status = 'voting'                -> true
  submissions.length === 0 -> re-arm: new deadline from settings.submissionTime,
                              same czarId, same topicId, same title,
                              currentRound unchanged, no history entry,
                              notice queued for the host                -> true
```

**Called from:** `get_group`, `join_group`, `submit_video`, `start_round`, `start_group`, and the new nudge event. Each caller persists and broadcasts only when it returns true.

**Contracts.** `group_updated` and `group_details` gain an optional per-player `notice`. One new inbound event carrying only a group id. No change to any existing field.

**Data.** No schema change. `deadline` already exists and already persists; the re-arm overwrites it in place.

**Responsibilities.** The server becomes the thing that ends a phase on time. The client stops being a passive display of a countdown that means nothing, and becomes the trigger that says "my clock says this expired, please look."

**Also required, found during the trace:** bound `submissionTime` server-side to 1-168 hours on `create_group` and `update_group`, the way `overrideThreshold` already is (`server/server.js:143-145`). Without it the re-arm can be handed an absurd window.

**Scenario 3** is handled separately and minimally: allow the host to reassign the Judge while the round is in `topic_selection`, reusing the existing Pick Judge modal and the `czarUserId` argument that `start_round` already accepts. No new timing concept is introduced into a phase whose lack of a clock is deliberate and well reasoned.

## Domain Model

- **Round** (`currentTheme`) — one prompt and its lifecycle. A restart under scenario 2 is **the same round**: `currentRound` does not increment and no history entry is written. This matters, because "restart" could otherwise be read as "new round", which would change the Judge and the topic — the opposite of what was asked for.
- **Deadline** — an absolute ISO instant, not a duration. Already the case, and it is what makes evaluation-on-read correct across a restart.
- **Expiry** — a property of the wall clock, not an event. Nothing needs to fire at the instant it passes; it only needs to be true when someone looks.

## Decisions

| Decision | Choice | Confidence | Reopen if |
|---|---|---|---|
| Seam | Persisted deadline evaluated at natural moments, plus a client nudge | High | Submission windows become minutes rather than hours, which would make a timer reasonable |
| Zero-submission behavior | Notify host, re-arm same Judge and topic | High — participant decision this session | The host asks for a way to cancel instead |
| Is a re-arm the same round? | Yes. No round increment, no history entry | Medium | Product wants each attempt recorded |
| Non-zero behavior | Advance to voting with what arrived | Medium — **inferred**, not stated | The participant intended a re-arm in both cases |
| Topic-selection stall | Host reassigns the Judge; no clock added | Medium | A group reports rounds stalling before submissions open |
| `submissionTime` validation | Add server-side bounds, 1-168 | High | — |

## Active Change Frontier

1. Should a re-arm be able to repeat forever? Today's design re-arms every window until someone submits, notifying the host each time. A cap, or a host cancel, may be wanted. **Needs participant judgment.**
2. Should the host also be able to close submissions early, before the deadline? Cheap to add on this seam and useful, but not required by the scenarios. **Needs participant judgment.**
3. Does the notice need to persist, or is delivery-on-connect enough for a host who was offline when the round restarted? **Needs participant judgment.**

## Decision Map

- Status: not needed
- Path: none
- Destination: the frontier is three product questions, not a structural uncertainty; the design is coherent without them
- Return condition: n/a

## Best Next Move

Publish the design, then put frontier questions 1 and 2 to the participant. Both change behavior the host sees, neither changes the seam.
