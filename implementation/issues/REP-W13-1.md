# REP-W13-1 — Wave 13 review repairs

- **Status:** Implemented (Wave 19; this *is* the review pass for Wave 13, so it has had no separate review of its own).
- **Priority:** medium
- **Guarantee:** Removing a player from a group removes them from the round in flight as well, and a non-member cannot use the join-request channel to discover which groups exist.

## Origin

Wave 13 shipped six features (`OG-1`, `JR-1`, `GS-1`, `GT-1`, `NT-1`, `UX-1`) built interactively rather than as a planned wave, so none of them had ever been reviewed. The queue carried that as a standing risk, flagging `JR-1`'s moderation surface and `OG-1`'s non-member visibility as where an unreviewed bug would hurt most. Both guesses were right: four of the five findings are in `JR-1`, and the fifth is the shape of the payload every member receives.

## What was wrong

### 1. Removing a player left them in the round

`kick_player` and `ban_player` spliced `group.players` and stopped there. Their submission stayed in the live round and could still win it. Nothing crashed — the scoring lookup is guarded — but the failure was visible to everyone: the winner resolved to a player who was no longer there, so the reveal named them **"Unknown"**, the winner's points went to nobody, and everyone who had voted for that submission still scored for it. Their votes also kept counting toward a result they were no longer part of.

### 2. Nothing re-asked whether the round could advance

The "everyone eligible has submitted" check lived inside `submit_video` and nowhere else, so it was only ever reachable by somebody submitting. Remove the one outstanding contestant and every remaining player had submitted — and nothing noticed. The round sat until its deadline, hours later. Not a hang, because RT-1's deadline eventually resolves it, but a stall the host caused and could not see.

### 3. Kicking the Judge stranded the round outright

`beginRound` is explicit that topic selection has no clock: *"No deadline yet: the submission clock starts when the topic is chosen."* So a Judge who is removed during topic selection leaves `czarId` pointing at a non-member with nothing to move the round on. A host reassign exists, but nothing tells the host they now need to use it.

### 4. `cancel_join_request` was a group-existence oracle

It looked the group up directly, with no membership gate, and returned early when it did not exist. A reply meant "this id is real" and silence meant "it is not" — for any id, private groups included. UI-2's membership gate exists precisely so that a non-member "learns nothing about the group — not even that it exists".

### 5. `publicizeGroup` was a denylist

It spread the whole group and deleted four private fields, so the default for anything new was to publish it. Adding a field to a group shipped it to every member unless someone remembered to come back and strip it. Nothing was leaking *today*; the defect is that the safe outcome depended on memory.

## What was done

- `detachFromLiveRound(group, userId)` — removes their submission, their votes, votes cast *for* their withdrawn submission, and their vote-budget entry, and passes the Judge role on if they held it during topic selection. **History is deliberately untouched**: rounds they actually played are shared records, and rewriting them would change other players' scores after the fact. Only the round still being decided is cleaned.
- `maybeOpenVoting(group)` — the all-submitted check, extracted so that whoever changes the roster re-asks the same question `submit_video` asks.
- Both are called from `kick_player`, `ban_player` **and `leave_group`**. Leaving was not one of the findings, but it is the identical bug reached a different way, and fixing two of the three paths would have been a half-fix.
- `cancel_join_request` answers a missing group exactly as it answers a real one the caller has no request in.
- `publicizeGroup` became an allowlist of 19 named fields. Every one was checked against the client first, so the set is identical to what shipped before — the change is that the default is now to withhold.

## Evidence

Five tests in `join-requests.spec.js`, each **proven red** by injecting the original behaviour rather than trusting a first-run pass:

| Fault injected | Test that caught it |
|---|---|
| `detachFromLiveRound` made a no-op | kicked player's submission; Judge handover |
| `cancel_join_request` early return restored | the existence oracle |
| `maybeOpenVoting` call removed from kick | kicking opens voting instead of stalling |
| allowlist reverted to a spread, plus a new private field on the group | payload carries only named fields |

The last one is worth noting: reverting the allowlist alone would *not* have failed, because the allowlist currently lists exactly the fields a spread produces. It only fails once a new field exists — which is the precise situation the allowlist is for, so that is the situation the fault recreated.

## Also found

- **A stale queue note, now corrected.** The queue listed "`get_groups` returns raw group objects (incl. `hostNotices`) to non-host members" as open and pre-existing. It has since been fixed — `get_groups` goes through `publicizeGroup`.

## What held up under review

Worth recording, because a review that only lists faults misrepresents the code:

- Every moderation handler checks the host against the **authenticated** identity rather than the payload; self-kick and self-ban are refused; `cleanId` is applied to every target id.
- `socket.join(userRoom(userId))` happens once at connect with the authenticated id and is never client-controlled, so no one can subscribe to another player's notifications.
- `openGroupSummary` is already an explicit allowlist — no invite code, no player ids.
- Topic selection validates **visibility** server-side, so a crafted id cannot pull in someone else's private topic; GT-1's one-play-per-set is enforced on the server, not merely as a disabled button.
- The notification cap is enforced at write.

## Not covered

- `GS-1`, `NT-1` and `UX-1` had spot checks only, not a line-by-line read. The two areas the queue named as highest-risk got the depth.
- `maxPlayers` is still displayed as a limit and never enforced — a standing note, not introduced here.
- This repair has had no independent review of its own.

## Depends on

None. Closes the standing "Wave 13 was not independently reviewed" note.
