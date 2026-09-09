# Prompted — Implementation Queue

The authoritative issue graph for implementation work. Built from the deep-discovery package (`docs/discovery/`) and maintained in place by `work-on-issues` waves.

Every issue file lives in [`implementation/issues/`](implementation/issues/). Each issue is in exactly one state. The `Ready` frontier is recomputed whenever a state or dependency changes.

## States

`Ready` — all prerequisites `Done`; may enter a wave.
`In progress` — selected for the current wave or has unresolved work.
`Blocked` — cannot proceed because of a real prerequisite, external condition, or a required Planning/Design decision.
`Implemented` — implementation and wave checks passed; independent review has not yet cleared it.
`Done` — independent review found no blocking defect.

## Wave history

| Wave | Commit | Issue ids | Outcome |
|---|---|---|---|
| Wave 1 | `8253c51` | `GL-1`, `GL-2`, `GL-3` | GL-2, GL-3 `Done`; GL-1 `Implemented` (review-work). Review filed `REP-GL1-1` (host-leave orphan) and `REP-GL1-2` (client-navigation test gap), both `Ready`, blocking GL-1. |

## Ready frontier

The current dependency-free frontier. An issue is listed here only when every issue it depends on is `Done`.

| Id | Title | Priority | Depends on |
|---|---|---|---|
| `REP-GL1-1` | A host who `leave_group` via a crafted socket orphans the group (host-less, undeletable) | high | — |
| `REP-GL1-2` | No e2e test proves the client navigates on `left_group` / `group_deleted` | medium | — |

Blocking: `GL-1` is `Implemented` and kept out of `Done` by `REP-GL1-1` and `REP-GL1-2`. `GL-2` and `GL-3` are `Done`.

## Out of scope for now (tracked as notes, not ready issues)

These are real findings but are deliberately **not** ready implementation issues in this wave. Leave them as notes until a wave owns them:

- **`allowDownvotes` is not server-enforced** (finding `f.settings`): a crafted `isDownvote:true` passes when the group forbids downvoting. The fix is a one-line server guard plus a raw-socket test. Smaller than a standalone wave; fold in when a wave touches the voting contract.
- **Voting has no deadline or host escape** (finding `f.deadline`): `votingTime` is never read and `close_submissions` only works during submission. This is a product/design decision (should voting get a clock or a host escape, and what should it do at expiry?). It needs a Planning/Design decision before it becomes a ready implementation issue. Track as `Blocked`-style note, not `Ready`.
- **`maxPlayers` / `totalRounds` are displayed as limits but never enforced** (finding `f.settings`): implementing enforcement changes product semantics (does a group end at `totalRounds`? is it a standing league?). Needs a product decision first.
- **Song preview, chat, voter identity, auto-start, skip-Judge settings are inert** (finding `f.settings`): removing, wiring, or completing them is a product decision, not a bug fix.
- **Session tokens cannot be revoked** (finding `f.norevoke`): a security change with its own review; needs scoping.
- **Account Settings toggles are cosmetic and Deactivate is a stub** (finding `f.ui-dead`): separate surface from the group wave; needs a product decision on what the toggles should do.
- **Downvote charges the voter as well as the target** (finding `f.downvote`): product decision on intended semantics.