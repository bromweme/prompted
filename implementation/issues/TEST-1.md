# TEST-1 — Joins wait for the host, not just the joiner

- **Status:** Implemented (Wave 17; no independent review yet).
- **Priority:** medium
- **Guarantee:** A test that joins a player to a group does not continue until the host's own page reflects the new member. No spec can act on a host that is still repainting.

## Origin

A `mobile-safari` failure on CI, on a commit that changed one line of `index.html`:

```
locator resolved to <button class="setup-button primary">Start Round</button>
37 × waiting for element to be visible, enabled and stable
   - element is not stable
```

Playwright found the button, confirmed it visible and enabled, and refused to click it for 120 seconds because its box kept changing between frames. That is not slowness, which is what the earlier `round-phases` mobile-safari failure looked like; it is continuous motion.

## Cause

Nineteen join sites shared one shape:

```js
await joiner.goto(await inviteJoinPath(host))
await expect(joiner.locator('.group-info-card')).toBeVisible()  // waits on the JOINER
await startRoundAsHost(host)                                    // acts on the HOST
```

The join was confirmed on the joining page and then the test immediately drove the host's — which it had never waited for. The host learns of a new member over `player_joined_group`, at a moment no test controls, and that re-renders the player list sitting directly above the Start button. The click therefore raced a layout shift.

It only ever surfaced on WebKit because it is the slowest engine in the matrix, and `retries: 0` turns one bad frame into a red build.

## Why the diagnosis is believed

The suite has failed on `mobile-safari` twice. Both failures were on the click immediately following a join, and the two specs involved were the two with the most unguarded joins:

| Spec | Joins | Host-side waits before this change |
|---|---|---|
| `topics.spec.js` | 6 | **0** — the failure reported here |
| `round-phases.spec.js` | 4 | 1 — the earlier failure |
| `modals`, `visibility`, `group-layout` | 2–3 | 0 |
| the rest | 2 | 1 |

`current-theme-heading.spec.js` was the only spec waiting on the host correctly, and it has never failed this way.

## What was done

One helper, and all nineteen sites converted to it:

```js
export async function joinGroupAs(joiner, host, expectedPlayers) {
  await joiner.goto(await inviteJoinPath(host))
  await expect(joiner.locator('.group-info-card')).toBeVisible()
  const noun = expectedPlayers === 1 ? 'player' : 'players'
  await expect(host.getByText(`${expectedPlayers} ${noun}`).first()).toBeVisible()
}
```

Waiting on the **count** is deliberate rather than incidental: `canStartRound` in `GroupView.jsx` is derived from `players.length`, so the text the helper waits for and the state that enables the button are the same thing. Waiting on anything else would be a proxy.

The three loop sites became incremental (`joinGroupAs(p.page, host.page, i + 2)`). Two of them previously asserted only the *final* total after the loop, which left every intermediate join unguarded; `accessibility.spec.js` had no host-side wait at all.

Net 14 lines shorter, because a three-line pattern repeated nineteen times had drifted into four variants.

## Honest limits

- **The CI failure was never reproduced locally.** Three repeats of the failing spec, a full-file run and a run in isolation were all green. The diagnosis rests on the correlation above plus the mechanism, not on a caught red test.
- **A green suite does not prove the fix**, because the suite was green locally beforehand. What changed is that the window is removed rather than narrowed: the test cannot proceed until the host's DOM reflects the join.
- **If CI fails in the same place again**, this was wrong, and the next step is the trace zip from the runner, which records the frame-by-frame box changes the local runs never produced.
- **`retries: 0` was left alone.** Retries would have hidden this instead of fixing it, and would hide the next one too.

## Affected surface

| Area | Change |
|---|---|
| `e2e/helpers.js` | New `joinGroupAs()` |
| `e2e/{topics,round-phases,modals,visibility,accessibility,video-titles,video-search,group-layout,leave-delete,rules-layout,current-theme-heading,round-deadline-display}.spec.js` | 19 join sites converted; redundant waits and now-unused imports removed |

## Done when

- No spec drives a host page after a join without first waiting for the host to show the new member.
- Full suite green.

## Depends on

None.
