# DEP-1 — Dependency and supply-chain scanning

- **Status:** Implemented (Wave 14, uncommitted at time of writing; no independent review yet).
- **Priority:** medium-high. Cheap, and it covers the one attack nobody here would otherwise see coming.
- **Guarantee:** A known-vulnerable package that ships is caught on the next push rather than whenever somebody happens to look. Updates arrive as reviewable pull requests on a schedule. What shipped in any given build can be reconstructed later.

## Origin

A test-layer and security review (see the queue note on the load/smoke tooling) found that nothing in the repo watched dependencies: no Dependabot, no `npm audit` in CI, no SBOM. Prompted's own code gets reviewed and tested heavily; its ~120 shipped transitive packages got nothing. That asymmetry is the point — an attacker does not need a bug in the game when a dependency will do.

The trigger was a discussion of a vendor article on web application security best practices. Most of that article's recommendations (WAF, bot mitigation, DDoS appliances) are aimed at a different threat model and were set aside; this one was correct and unaddressed.

## Baseline at the time of writing

Both packages were clean — `server` and `web-app`, zero advisories at every severity, dev dependencies included. So a blocking check could be introduced without first fixing a backlog, which is the easiest moment to introduce one.

## What was added

**`.github/dependabot.yml`**
- npm updates for `/server` and `/web-app`, plus `github-actions` for the workflow's own pinned actions, weekly on Monday.
- Patch and minor updates are **grouped** into one pull request per package, so an ordinary week is one review rather than fifteen. Majors come separately, because they need reading.
- Version updates only. Dependabot **alerts** and automatic security fixes are a repository setting (Settings → Code security) and still want turning on: they react the day an advisory lands instead of waiting for Monday.

**`audit` job in `.github/workflows/tests.yml`** — one per package:
- `npm audit --omit=dev --audit-level=high` **blocks**. A high or critical advisory in something a player's traffic actually reaches is a real exposure.
- `npm audit` over everything, including dev, is **informational** (`continue-on-error`). A vulnerable bundler or test runner is worth knowing about and not worth blocking a release over, since no player can reach it. Blocking on it would teach everyone to ignore the job.
- `npm sbom --sbom-format cyclonedx --omit=dev` is uploaded as an artifact, kept 90 days. Verified locally: CycloneDX 1.5, 121 components for the server.

`sbom-*.json` is gitignored, so a local run cannot commit one; the record that counts is the artifact tied to a commit.

## Affected surface

| Area | Change |
|---|---|
| `.github/dependabot.yml` | New: grouped weekly npm + actions updates |
| `.github/workflows/tests.yml` | New `audit` job, two packages, blocking on shipped high/critical |
| `.gitignore` | Ignore generated SBOMs |
| `README.md` | Describes both CI additions |

## Done when

- A high or critical advisory in a shipped dependency fails CI.
- A dev-only advisory is visible in the run without failing it.
- Each build leaves an SBOM of what shipped.
- Dependabot opens grouped update pull requests on a schedule.
- No existing advisory is being silently tolerated (baseline was zero).

## Not in scope

- **SAST.** CodeQL is free for public repositories and would cover the code itself rather than its dependencies. A separate, larger decision.
- **`npm audit signatures`** (registry provenance) and pinning by integrity beyond the lockfile.
- **Session revocation**, already tracked separately as a note.
- Dependabot **alerts** as opposed to version updates: a repository setting, not a file in the repo, so it needs a human with admin rights.

## Depends on

None.
