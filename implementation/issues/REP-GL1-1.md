# REP-GL1-1 — A host who leaves orphans the group (host-less and undeletable)

- **Status:** Implemented (Wave 2, worker A; awaiting closure review)
- **Priority:** high
- **Guarantee to restore:** A group must always have a host who is a current member, so the group can always be started, edited, transfer-resilient, and deleted. Removing a member must never strand a group in a state no remaining member can recover.
- **Blocks:** `GL-1` (keeps it from reaching `Done`)
- **Depends on:** none

## Failed behavior

A host can remove themselves from the group by emitting a crafted `leave_group` event. The server's `leave_group` handler (`server/server.js:1022-1041`) removes whoever the caller `socket.data.userId` is — with no host guard. After a host leaves this way:

- `group.host` still points at the departed host's `userId`, which is no longer in `group.players`.
- No remaining member can delete the group (host-only check at `server/server.js:1063`).
- Host notices stop routing, because `noticesFor` (`server/server.js:386-389`) only returns notices to `group.players` whose `userId` equals `group.host`.
- The group persists forever with no member able to delete or reclaim it.

## Trigger

Ordinary UI use cannot trigger it: the Group View gives hosts a Delete Group button, not a Leave Group button, so the leave affordance is hidden from hosts. It becomes reachable through a crafted/raw socket message or any future client path that lets a host leave, because the server accepts `leave_group` from any member including the host.

## Affected flow

1. Host socket emits `leave_group { groupId }`.
2. `leave_group` (`server/server.js:1022`) finds the host in `group.players`, splices them out (`:1032-1034`), persists via `groups.set`, and rebroadcasts.
3. `left_group { groupId }` is sent to the host (`:1041`), which navigates them to the dashboard.
4. Observable failure: `group.host` now names a user who is not a member; the group is undeletable and unmanageable.

Components that must change: `server/server.js` (`leave_group`), and only if host transfer is chosen, the client Group View to present the transfer if the server supports it. The repair must restore the guarantee without prescribing the mechanism (guard host leave, or transfer hostship to a remaining member before removal, mirroring the `reassign_judge` pattern at `server/server.js:940`).

## Repair requirements

- A member who is the current `group.host` must not be able to leave in a way that leaves the group host-less. Either reject host leave, or reassign the host to a connected remaining member before honoring the leave.
- The observable outcome of ordinary non-host leave (GL-1) must be unchanged.
- No data or authorization regression: the existing host-only `delete_group` and host-notice guarantees still hold.

## Done when

- A host who attempts `leave_group` either is refused (group keeps an intact host who remains a member) or, if host transfer is chosen, the hostship passes to a connected remaining member, and the leaving host is removed.
- The group always has a host who is a current member after any leave.
- A focused regression check covers the host-leave path (raw-socket host `leave_group`, then verify the group remains manageable and deletable by a member).
- The GL-1 ordinary member-leave, rejoin, and group_deleted behaviors still pass.

## Depends on

None.