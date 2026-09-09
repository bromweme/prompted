# Evidence Catalog

Every piece of evidence behind [the report](../../prompted-deep-discovery.md) and [the knowledge base](index.md), recorded once and referenced by id. Generated from [application-model.json](application-model.json) at revision `cfa08f6` plus the uncommitted working-tree drift. Do not hand-edit this file; regenerate it from the model.

Support levels used here:

- **demonstrated by test** - a test asserts it and that test passes
- **established by reading the source** - the code says so; it was not watched running
- **declared by the source** - a document or comment claims it; treated as a claim, not a fact

Nothing in this catalog is marked *observed at runtime*. The application was never driven by hand during this discovery; it was read, and its test suite was run.

| Total entries | 52 |
|---|---|
| Demonstrated by test | 9 |
| Established by reading source | 40 |
| Declared by a source | 3 |

## Test results

### `ev.deadline.test`

13 tests (395 lines) drive the real deadline seam with raw socket clients: expiry-into-voting, a premature nudge is ignored, re-arm keeps Judge/topic, exhaustion raises round_stalled, host notice acknowledgment, close_submissions, reassign_judge, and submissionTime validation.

- **Where:** `web-app/e2e/round-deadline.spec.js:1-395`
- **Support:** demonstrated by test
- **Cited by:** `cap.deadline`, `f.authority`, `f.deadline`, `flow.round/s.3`

### `ev.csstoken.regression`

The static token guard (undefined var() check) caught a real regression in the new host-notice styling: GroupView.css:1284 referenced an undefined token var(--color-text); the static guard failed across all four browser projects until it was corrected to var(--color-text-primary) in this refresh.

- **Where:** `web-app/src/pages/GroupView.css:1284`
- **Support:** demonstrated by test
- **Cited by:** `f.a11y`, `f.casstoken`, `f.stability`

### `ev.entities.test`

Entity decoding is asserted in the search results, the selected-video confirmation and the broadcast round-video list, and each page is checked to contain no raw entity text.

- **Where:** `web-app/e2e/video-titles.spec.js:32-137`
- **Support:** demonstrated by test
- **Cited by:** `cap.entities`

### `ev.topics.test`

A stranger's public topic never appears in another user's library and reaches them only through a shared group.

- **Where:** `web-app/e2e/topics.spec.js:132-228`
- **Support:** demonstrated by test
- **Cited by:** `cap.topics`, `flow.topics`

### `ev.judge.hidden.test`

Judge identity is absent from every captured websocket frame before reveal, and submissions carry no playerUserId during voting.

- **Where:** `web-app/e2e/game-loop.spec.js:124-169`
- **Support:** demonstrated by test
- **Cited by:** `cap.round.anonymity`, `cap.round.run`, `f.authority`, `f.privacy`, `flow.round`

### `ev.selfvote.test`

A hand-crafted socket payload naming the voter's own submission is refused by the server, independently of the disabled UI control.

- **Where:** `web-app/e2e/round-phases.spec.js:296-381`
- **Support:** demonstrated by test
- **Cited by:** `f.authority`

### `ev.offline.test`

A round starts while another member is disconnected.

- **Where:** `web-app/e2e/round-phases.spec.js:126-153`
- **Support:** demonstrated by test
- **Cited by:** `cap.group.join`

### `ev.suite.result`

Full end-to-end suite across all four browser projects.

- **Where:** `web-app`
- **Support:** demonstrated by test
- **Result:** 260 passed (65 tests x 4 projects)
- **Cited by:** `cap.a11y`, `f.scoringuntested`, `f.stability`, `flow.round`, `n.suite`, `r.suite.client`, `r.suite.server`

### `ev.suite.stability`

Five consecutive full-suite runs at workers=4 with retries disabled, to measure the flake rate. The suite has since grown to 260 executions/run and added the deadline machinery; the css-tokens guard caught one real regression (now fixed).

- **Where:** `web-app`
- **Support:** demonstrated by test
- **Result:** At baseline: 5/5 green, 1,040 executions, 0 failures, 0 retries. The current suite runs 260 executions per run across four projects.
- **Command:** 5 x npx playwright test
- **Cited by:** `cap.a11y`, `f.stability`

## Source analysis

### `ev.round.lifecycle`

beginRound creates currentTheme with status 'topic_selection' and deadline null (the Submission clock starts when the topic is chosen, not when the round begins). publicizeTheme and calculateGroupResults drive the submission, voting and reveal transitions.

- **Where:** `server/server.js:244-281`
- **Support:** established by reading the source
- **Cited by:** `cap.round.run`, `flow.round`, `flow.round/s.2`, `n.judge`, `n.server`, `n.theme`, `r.group.theme`, `r.judge.theme`

### `ev.round.publicize`

publicizeTheme strips czarId from every broadcast, hides submissions and votes during topic_selection and submission, anonymizes submissions during voting, withholds comments unless showCommentsLive is on, and exposes the Judge id early when anonymousCzar is false.

- **Where:** `server/server.js:286-330`
- **Support:** established by reading the source
- **Cited by:** `cap.round.anonymity`, `f.privacy`, `flow.round/s.4`, `flow.round/s.6`

### `ev.round.scoring`

calculateGroupResults tallies votes, resolves the winner by public override (submission whose vote share meets the threshold), then Judge selection, then popular vote; charges downvotes, then appends a history entry carrying every video in the round.

- **Where:** `server/server.js:393-480`
- **Support:** established by reading the source
- **Cited by:** `cap.round.run`, `f.scoringuntested`, `flow.round`, `flow.round/s.5`, `flow.round/s.6`

### `ev.deadline.set`

theme.deadline is computed from settings.submissionTime when the Judge selects a topic (select_topic), so the submission clock starts on the pick.

- **Where:** `server/server.js:634`
- **Support:** established by reading the source

### `ev.deadline.contract`

advanceIfExpired is the single idempotent deadline seam: guarded on phase, deadline and rearmExhausted; evaluated against the server's own clock (no scheduler, no timer); opens voting when submissions arrived; otherwise restarts the same round (kept Judge and topic, currentRound not incremented, no history entry) up to MAX_AUTO_REARMS, then stalls for the host.

- **Where:** `server/server.js:198-238`
- **Support:** established by reading the source
- **Cited by:** `cap.deadline`, `f.deadline`, `flow.round`, `flow.round/s.2`, `flow.round/s.3`, `n.theme`

### `ev.deadline.rearm`

MAX_AUTO_REARMS is 3; addHostNotice raises durable host messages with kinds 'round_restarted' (each re-arm) and 'round_stalled' (attempts exhausted).

- **Where:** `server/server.js:169-182`
- **Support:** established by reading the source
- **Cited by:** `cap.deadline`, `f.deadline`

### `ev.deadline.callsites`

advanceIfExpired is evaluated at join_group (:805), get_group (:852), submit_video (:1203) and again when the client emits check_round_deadline (:872-882) as its countdown reaches zero. There is no scheduler: an idle group advances only when someone interacts with it, so enforcement is interaction-driven rather than timed.

- **Where:** `server/server.js`
- **Support:** established by reading the source
- **Cited by:** `cap.deadline`, `f.deadline`, `flow.round/s.4`

### `ev.deadline.validation`

submissionTime is validated as a whole number of hours from 1 to 168 at group creation and on edit. A value outside the bounds is rejected on both paths.

- **Where:** `server/server.js:159-162`
- **Support:** established by reading the source

### `ev.deadline.novoting`

No server behavior reads settings.votingTime; close_submissions only acts while the phase is 'submission' (status gate), so there is no host escape from a round stuck in voting. A round in voting hangs until every eligible voter votes or the Judge names a winner.

- **Where:** `server/server.js`
- **Support:** established by reading the source
- **Cited by:** `cap.votingdeadline`, `f.deadline`, `flow.round/s.5`

### `ev.ui.editvideo`

The submit modal branches its title and button on isEditing ('Edit Video'/'Update Video'), and setIsEditing is only ever called with false. setIsEditing(true) is never called, so the Edit Video path is unreachable.

- **Where:** `web-app/src/pages/GroupView.jsx`
- **Support:** established by reading the source
- **Cited by:** `f.ui-dead`

### `ev.ui.dashboards`

The Active/Completed/Archived tab buttons carry no filtering behavior (they are presentational), and the Quick Actions cards have no onClick handlers at all.

- **Where:** `web-app/src/pages/Dashboard.jsx`
- **Support:** established by reading the source
- **Cited by:** `f.ui-dead`

### `ev.ui.account`

The Account Settings toggles (Email Notifications, Public Profile, Sound Effects) are cosmetic defaultChecked checkboxes with no persistence, and Deactivate Account is a stub with no behavior.

- **Where:** `web-app/src/pages/Account.jsx`
- **Support:** established by reading the source
- **Cited by:** `f.ui-dead`

### `ev.ui.phaselabel`

The Overview phase label shows 'Voting' for voting, 'Results' for reveal, and 'Submissions Open' for any other phase - so during topic_selection, before a topic or deadline exists, it is misleading.

- **Where:** `web-app/src/pages/GroupView.jsx:672`
- **Support:** established by reading the source
- **Cited by:** `f.ui-dead`

### `ev.membership.gate`

Round start requires at least MIN_PLAYERS_TO_START group members; the comment states that presence is deliberately not considered.

- **Where:** `server/server.js:1042-1046`
- **Support:** established by reading the source
- **Cited by:** `flow.round/s.1`

### `ev.beginround.pool`

beginRound prefers connected players but falls back to the full roster; a host-forced Judge (czarUserId) is looked up with no connected check.

- **Where:** `server/server.js:244-256`
- **Support:** established by reading the source
- **Cited by:** `f.deadline`, `flow.round/s.1`

### `ev.vote.judge`

cast_vote contains no Judge exclusion; the handler comment states that any connected player including the Round Leader may vote. A player whose own submission is the only one on offer is not an eligible voter.

- **Where:** `server/server.js:1285-1287`
- **Support:** established by reading the source
- **Cited by:** `flow.round/s.4`

### `ev.vote.selfblock`

Self-vote is refused server-side, not only disabled in the UI.

- **Where:** `server/server.js:1243-1246`
- **Support:** established by reading the source
- **Cited by:** `flow.round/s.4`

### `ev.vote.downvote.record`

A downvote is stored with its points negated to minus downvoteCost, which is then summed into the submission tally.

- **Where:** `server/server.js:1274`
- **Support:** established by reading the source
- **Cited by:** `f.downvote`

### `ev.vote.downvote.voter`

calculateGroupResults separately deducts downvoteCost from the voter, unconditionally, whether or not the downvoted submission won.

- **Where:** `server/server.js:445-454`
- **Support:** established by reading the source
- **Cited by:** `f.downvote`

### `ev.settings.readby.server`

The server reads exactly nine settings keys: allowOverride, allowVotingComments, anonymousCzar, czarPoints, downvoteCost, maxJuryPoints, overrideThreshold, showCommentsLive, submissionTime.

- **Where:** `server/server.js`
- **Support:** established by reading the source
- **Result:** grep -ohE 'settings\.[a-zA-Z]+' server/server.js | sort -u -> 9 distinct keys
- **Cited by:** `cap.group.create`, `f.settings`, `f.threshold`

### `ev.settings.sentby.client`

The Create Group wizard transmits 21 settings keys in a single create_group payload.

- **Where:** `web-app/src/pages/CreateGroup.jsx:104-131`
- **Support:** established by reading the source
- **Cited by:** `cap.group.create`, `f.settings`, `n.webapp`

### `ev.settings.display.only`

totalRounds and maxPlayers appear only as rendered text and in the rules summary; no code branches on either value.

- **Where:** `web-app/src/pages/GroupView.jsx`
- **Support:** established by reading the source
- **Cited by:** `cap.gameend`, `f.settings`

### `ev.settings.downvotes.clientonly`

allowDownvotes gates the downvote control in the UI only; cast_vote never checks the toggle, so a crafted isDownvote:true still passes.

- **Where:** `web-app/src/pages/GroupView.jsx:1013`
- **Support:** established by reading the source
- **Cited by:** `f.settings`

### `ev.leave.noemit`

handleLeaveGroup runs a confirm dialog and then navigates away; it emits no socket event.

- **Where:** `web-app/src/pages/GroupView.jsx:1636-1655`
- **Support:** established by reading the source
- **Cited by:** `cap.leave`, `f.leave`

### `ev.leave.noevent`

An exhaustive grep of client socket emits returns no leave_group or delete_group, and the server registers no such handler.

- **Where:** `web-app/src`
- **Support:** established by reading the source
- **Result:** grep -ohE "emit\('[a-z_]+'" -r web-app/src | sort -u -> no leave or delete event
- **Cited by:** `cap.leave`, `f.leave`

### `ev.host.fixed`

group.host is set once at creation and no handler reassigns it.

- **Where:** `server/server.js`
- **Support:** established by reading the source
- **Cited by:** `cap.hosttransfer`, `f.host`, `n.group`, `n.host`, `r.host.group`

### `ev.auth.middleware`

Identity is bound once by the connection middleware; handlers read socket.data.userId and never trust a payload field.

- **Where:** `server/server.js:486-494`
- **Support:** established by reading the source
- **Cited by:** `cap.profile`, `cap.signin`, `f.authority`, `flow.identity`, `flow.identity/s.2`, `n.authmw`, `n.player`, `n.socket`, `r.client.socket`, `r.server.authmw`, `r.socket.server`

### `ev.auth.testmode`

AUTH_TEST_MODE is guarded at boot (the process exits if it is combined with NODE_ENV=production), re-checked at call time in auth.js, and the matching client seam is dev-build only.

- **Where:** `server/config.js:12-16`
- **Support:** established by reading the source
- **Cited by:** `flow.identity`, `flow.identity/s.1`, `n.google`, `r.authmw.google`

### `ev.session.token`

Session tokens are a base64url payload plus an HMAC-SHA256 signature, deliberately not JWT, compared in constant time, and carried only on the socket handshake.

- **Where:** `server/session.js:4-11`
- **Support:** established by reading the source
- **Cited by:** `cap.signin`, `f.norevoke`, `flow.identity`, `flow.identity/s.3`, `n.session`, `r.authmw.session`

### `ev.session.norevoke`

Verification recomputes the HMAC and checks the expiry claim; no record of issued tokens exists, so there is no way to revoke one early.

- **Where:** `server/session.js:55-83`
- **Support:** established by reading the source
- **Cited by:** `f.norevoke`, `flow.identity/s.5`

### `ev.db.store`

PersistentStore is a Map-compatible write-through cache over a SQLite table in WAL mode, storing one JSON blob per row.

- **Where:** `server/db.js:1-55`
- **Support:** established by reading the source
- **Cited by:** `flow.identity/s.4`, `n.profiles`, `n.sqlite`, `n.store`, `r.profiles.store`, `r.server.store`, `r.store.sqlite`

### `ev.db.mutationhazard`

get() returns the live cached object; a caller that mutates it without calling set() again leaves memory and disk out of step.

- **Where:** `server/db.js:27-29`
- **Support:** established by reading the source
- **Cited by:** `f.dbmutation`

### `ev.youtube.quota`

A search.list call costs 100 of 10,000 daily units; results are cached by normalized query with a 30-minute TTL and a 500-entry LRU bound.

- **Where:** `server/youtube.js:6-41`
- **Support:** established by reading the source
- **Cited by:** `cap.search`, `n.youtube.mod`, `n.ytapi`, `r.server.youtube`, `r.youtube.api`

### `ev.youtube.decode`

Entity decoding is applied to API results before writeCache, and to the fixture list once at module load.

- **Where:** `server/youtube.js:126-137`
- **Support:** established by reading the source
- **Cited by:** `cap.search`, `r.youtube.entities`

### `ev.entities.module`

A decode-only fixed-table transform with full numeric and hex support: no DOM, no parser, a single pass, and unknown entities left untouched.

- **Where:** `server/htmlEntities.js:1-58`
- **Support:** established by reading the source
- **Cited by:** `cap.entities`, `n.entities`

### `ev.topics.scope`

get_topics returns only the caller's own topics; topicsForGroup adds other members' public topics but only within a group they actually share.

- **Where:** `server/server.js`
- **Support:** established by reading the source
- **Cited by:** `cap.topics`, `flow.topics`, `flow.topics/s.1`, `flow.topics/s.2`, `flow.topics/s.3`, `n.topic`, `r.player.topic`

### `ev.css.invisible`

An undefined custom property invalidates the whole declaration at computed-value time, so background fell back to transparent while the sibling color declaration survived. Every primary button rendered invisible while the suite stayed green.

- **Where:** `web-app/e2e/css-tokens.spec.js:6-15`
- **Support:** established by reading the source
- **Cited by:** `cap.a11y`, `f.a11y`, `f.focusgap`

### `ev.a11y.cascade`

The hover audit simulates the real cascade (importance, specificity, source order) rather than overlaying hover rules, after the overlay approach produced a false positive on an active tab.

- **Where:** `web-app/e2e/a11y-audit.js:156-163`
- **Support:** established by reading the source
- **Cited by:** `cap.a11y`, `f.a11y`, `f.focusgap`

### `ev.skipczar.absent`

The documented skip-Judge rotation, its skipped_czar_count field and its skip_czar event have no counterpart in the server.

- **Where:** `server/server.js`
- **Support:** established by reading the source
- **Result:** grep for skip czar across server/ returns no matches
- **Cited by:** `cap.skipjudge`

## Configuration

### `ev.corpus`

84 source files with no byte-identical duplicates; 1,661 generated Playwright artifacts excluded from review.

- **Where:** `source corpus manifest`
- **Support:** established by reading the source
- **Result:** 84 corpus files, 0 duplicates, 1661 generated files excluded
- **Command:** source-corpus.py inventory
- **Cited by:** `f.docs`

## Documentation

### `ev.docs.stale`

README.md and GAME_DESIGN.md describe Spotify, PostgreSQL, a React Native app under src/, in-memory state and no user accounts. None of these match the implementation.

- **Where:** `README.md:1-195`
- **Support:** declared by the source, not independently confirmed
- **Cited by:** `cap.skipjudge`, `f.docs`

### `ev.docs.selfconflict`

README.md describes Spotify submission as the current mechanism and simultaneously lists Spotify integration under Future Enhancements and no real Spotify integration under Current Limitations.

- **Where:** `README.md:69-163`
- **Support:** declared by the source, not independently confirmed
- **Cited by:** `f.docs`

### `ev.docs.env.accurate`

The environment examples describe Google sign-in, the YouTube Data API and session tokens, and they match the implementation.

- **Where:** `server/.env.example:1-30`
- **Support:** declared by the source, not independently confirmed
- **Cited by:** `f.docs`

---
