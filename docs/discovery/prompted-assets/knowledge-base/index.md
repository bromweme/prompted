# Prompted Discovery Knowledge Base

The evidence-linked layer behind [the report](../../prompted-deep-discovery.md). The canonical machine-readable model is [application-model.json](application-model.json); documented intent is reconciled in [source-model.json](../source-model.json). Every claim below carries an evidence id you can look up in [evidence-catalog.md](evidence-catalog.md).

Written for product, operations and engineering readers, and for future agents picking this work up cold.

## What Prompted is, in one paragraph

A multiplayer music game. A Judge sets a prompt, every other player answers it with one YouTube video, everyone votes, and a winner is scored. Groups are standing — the same people play round after round and keep a shared history. The differentiator against a plain voting app is the Judge: an anonymous adjudicator whose identity, like the submitters' identities, stays hidden until the round is over.

## Outcomes it creates

1. A group of friends discovers music through each other, one prompt at a time.
2. Judging stays fair, because nobody knows who submitted what or who is judging until the round ends.
3. Prompts stay private to the people you actually play with, never shared app-wide.

## The three value paths

| Path | Status | Where to read it |
|---|---|---|
| `flow.round` — play a round from prompt to reveal | demonstrated by test | `server/server.js:198-238, 240-375` |
| `flow.identity` — become a trusted identity | implemented and connected | `server/auth.js`, `server/session.js` |
| `flow.topics` — own a topic, share it only with groupmates | demonstrated by test | `server/server.js` (`get_topics`, `topicsForGroup`) |

## Decision state, at a glance

**Settled and written down** — these carry a comment explaining the reasoning, which is unusual and worth preserving:

- Only "Judge Selects" ships as a topic-selection mode; three alternatives are commented out with the mechanics each would need (`ev.settings.sentby.client`)
- Rounds are gated on group membership, never on who happens to be connected (`ev.membership.gate`)
- The submission deadline is enforced on interaction, not by a timer, with a zero-submission re-arm capped at three attempts (`ev.deadline.contract`, `ev.deadline.rearm`)
- A public topic reaches groupmates only, never the whole app (`ev.topics.scope`)
- Session tokens are deliberately not JWT (`ev.session.token`)

**Settled in code, unrecorded in prose** — complete and deliberate, but no document mentions either:

- Spotify became the YouTube Data API
- PostgreSQL became SQLite

**Unclear** — see [open questions](#open-questions).

## The findings that matter

Ranked. Full detail in [the report](../../prompted-deep-discovery.md).

| Id | Finding | Priority |
|---|---|---|
| `f.docs` | Both narrative documents describe a materially different product | high |
| `f.deadline` | The stall is fixed; a no-submission round restarts (up to 3), voting has no deadline, enforcement is interaction-driven | high |
| `f.settings` | Nine of 21 server-enforced; several more (incl. totalRounds, maxPlayers) never do anything and two are shown as limits | high |
| `f.leave` | Leave Group and Delete Group are presented as destructive but do nothing | high |
| `f.scoringuntested` | Only one scoring path is ever played to resolution | high |
| `f.host` | The host role is permanent and cannot be transferred | medium |
| `f.downvote` | A downvote costs points twice, and the voter penalty is unconditional | medium |
| `f.norevoke` | Session tokens cannot be revoked and last 30 days | medium |
| `f.focusgap` | A control invisible on keyboard focus would pass every check | medium |
| `f.authority` | The server is a genuine authority, not a message relay | medium |
| `f.privacy` | Concealment is enforced by withholding data, not by hiding it | medium |
| `f.a11y` | The accessibility guard covers a bug class axe cannot see | medium |
| `f.ui-dead` | Several controls read as actionable but are dead or misleading (Edit Video, Dashboard tabs/cards, Account toggles, Overview label) | medium |
| `f.stability` | The suite is stable; one real regression is caught by the css-tokens guard | medium |
| `f.casstoken` | The static token guard caught a real undefined-token regression, now fixed | low |
| `f.threshold` | An invalid override threshold is corrected on create, rejected on edit | low |
| `f.dbmutation` | The store tolerates a caller that mutates and forgets to save | low |

## Capability status

The strongest status each capability's evidence actually supports. Nothing is marked "observed working" — the application was never driven by hand in this discovery, only read and tested.

| Capability | Status |
|---|---|
| Run a round from topic to reveal | demonstrated by test |
| Conceal identities until reveal | demonstrated by test |
| Personal topic library, scoped to groupmates | demonstrated by test |
| Join a group by code or invite link | demonstrated by test |
| Player profile with display name and avatar | demonstrated by test |
| Correct display of API-escaped titles | demonstrated by test |
| Accessibility guarding across the whole site | demonstrated by test |
| Google sign-in with durable session | implemented and connected |
| YouTube search with quota control | implemented and connected |
| Create a group through a four-step wizard | **partial** — nine of 21 settings reach any behavior |
| Submission time limit | demonstrated by test (the deadline is enforced) |
| Deadline on the voting phase | **documented but not found** — nothing forces voting to reveal |
| Leave or delete a group | **stubbed** — no event, no handler |
| Skip being Judge | **documented but not found** |
| Finish a game after a set number of rounds | **documented but not found** |
| Transfer or replace the host | **documented but not found** |

## Best entry points into the evidence

- **To understand the game:** `ev.round.lifecycle`, `ev.round.scoring`, `ev.round.publicize`
- **To understand what is broken:** `ev.deadline.novoting`, `ev.leave.noevent`, `ev.settings.readby.server`, `ev.ui.editvideo`
- **To understand what is well built:** `ev.judge.hidden.test`, `ev.selfvote.test`, `ev.auth.middleware`, `ev.deadline.contract`
- **To understand the test suite:** `ev.suite.result`, `ev.deadline.test`, `ev.a11y.cascade`, `ev.csstoken.regression`
- **To understand the documentation problem:** `ev.docs.stale`, `ev.docs.selfconflict`, `ev.docs.env.accurate`

## Open questions

These need a person, not more reading.

1. **Should the Judge both vote and hold an outright winner pick?** (`u.judgevote`) The code allows both deliberately and the documents agree — but nothing records whether giving one person two levers on the same outcome was weighed.
2. **Is a downvote meant to cost the voter as well as the target?** (`u.downvote`) Both happen today.
3. **Was skip-Judge dropped or never built?** (`u.skipjudge`) Its setting is still collected by the wizard.
4. **What is the role finally called?** (`u.rolename`) Judge, czar and Round Leader all appear in the code.
5. **Should a group end after `totalRounds`?** (`u.gameend`) The interface counts toward a limit nothing applies.
6. **Does the documented mobile app exist anywhere?** (`u.mobile`)

## How to trust this

- Findings marked from static analysis come from reading code, not from watching it run.
- Every contested claim was re-verified directly against the source by the lead. Two disagreements between bounded investigations were resolved against the code and the incorrect readings discarded — one about whether the Judge may vote (they may), one about whether a live-comments setting was inert (it is enforced server-side and covered by a test).
- Repository history is shallow relative to this work, so a decision not captured in a code comment usually cannot be dated.
