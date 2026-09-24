# SEC-2 — One definition per setting, and a group size that means something

- **Status:** Implemented (Wave 21; no independent review yet).
- **Priority:** medium
- **Guarantee:** A group cannot exceed its own player limit, and every setting the two forms offer is bounded in one place, mirrored by a server clamp that does not trust either form.

## Origin

The last open item on the **Before go-live** list, and the user's answer to the question it was blocked on:

> max of 20 players, please change the edit rules form for max players to match wizard form dropdown

Then, having seen the fix: *"Please make sure each form input are shared by both forms."* That second instruction is what turned a one-field change into this issue, and it was the right call — `maxPlayers` was not the only field the two forms disagreed about.

## What was wrong

`maxPlayers` was collected by both forms, displayed on the group page as `3/12`, and **never read by the server**. The number was decorative: a group advertising a limit of 12 would take a thirteenth player without complaint.

Underneath that was a structural problem. There are two forms that write group settings — the Create Group wizard and the Edit Rules panel — and each held its own private copy of every limit. They had drifted:

| Setting | Wizard | Edit Rules | Server |
|---|---|---|---|
| `maxPlayers` | select, ≤ 20 | number, ≤ **50** | **no clamp** |
| `totalRounds` | select, 4–12 | number, 1–**20** | 1–50 |
| `maxJuryPoints` | number, 1–**5** | number, 1–**10** | **no clamp** |
| `czarPoints` | 1–10 | 1–10 | **no clamp** |
| `overrideThreshold` | **slider** | **number box** | own policy |
| `downvoteCost` | min **0** | min **0** | min 1, **no max** |
| `voteBudget` | 1–100 | 1–100 | 1–100 ✓ |

Three of those settings had no server-side bound at all, which means their limits lived only in a `min`/`max` attribute — a guard against a slip, not against a crafted payload. And `downvoteCost` offered 0 in both forms while the server has always forced 1 (RT-2-1: a free downvote lets a player vote past their budget), so choosing 0 silently became 1.

## What was done

- **`web-app/src/utils/groupSettings.js`** holds the choices and ranges once. Both forms read from it, so they cannot drift again without someone editing the shared file.
- **Both forms now use the same control** for the same setting: a select for `totalRounds` and `maxPlayers`, a slider for `overrideThreshold`, matching number bounds elsewhere.
- **`maxPlayers` is enforced**, in `joinRefusal` — the one function every way in already passes through (invite code, invite link, open group, accepted request). A member reconnecting never reaches it, because `completeJoin` only asks about someone new.
- **Clamped on read as well as on write**, so a group stored with 50 from the old form is still held to 20, and a startup migration corrects the stored value so the page cannot display `3/50` while refusing a fourth player at 20.
- **Server clamps added** for `czarPoints`, `maxJuryPoints` and an upper bound for `downvoteCost`.

The rule between the layers: **the server's range must be at least as wide as what the form offers.** A form offering a value the server will refuse is how a control comes to do something other than what it says.

## Two judgement calls

- **`maxJuryPoints` standardised on 1–10, not the wizard's 1–5.** Edit Rules already allowed 10, so groups may be stored with 6–10. Narrowing the range would make a stored value unrepresentable in the form meant to edit it. The selects apply the same principle: a value outside the list shows as "N (current)" rather than the form silently reporting a number the group does not have.
- **`overrideThreshold` was left out of the clamping**, after the first attempt wrongly included it. It already had a policy and it is not clamping: create coerces an invalid value to the default, and update *refuses* it, because — in the existing comment — "a bad threshold should surface immediately, not decay the override mechanic quietly". A clamp is not a refusal. Making the codebase consistent is not a licence to overwrite a decision someone already made deliberately, and there is now a test asserting the refusal so the rule is not mistaken for an oversight later.

## Evidence

Four tests in `game-rules.spec.js`: a full group refuses the next player; **a member reconnecting to a full group still gets in** (the case a naive capacity check breaks); a crafted payload is clamped on create; the edit path is held to the same bounds, and refuses a bad threshold.

## Process note

Three test runs during this work were worthless and one of them nearly got reported as a result: a full suite was running while `server.js` was edited, and a later run reused that suite's fourteen-minute-old server through `reuseExistingServer`, producing three failures that were entirely environmental. The user caught it. **A green number from a compromised run is worse than no number**, because it gets acted on. Only run one suite at a time, and change nothing while it runs.

## Not covered

- `totalRounds` still clamps to 1–50 server-side while the forms offer 4–12. That direction is safe (the server is wider than the form) and narrowing it would strand stored values.
- Nothing ejects players from a group that is already over a newly-lowered limit; the limit only refuses new arrivals.

## Depends on

None. Closes the standing "`maxPlayers` is displayed as a limit but never enforced" note.
