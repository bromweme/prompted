# Prompted Discovery Package

Current-state discovery of the Prompted codebase, completed 9 September 2026 at revision `cfa08f6` plus the uncommitted working-tree drift that followed it (round-stall/deadline work, profile system, phase rework, new e2e suite). Everything here describes what exists now. Nothing here proposes a target architecture, a migration or a roadmap.

**Start here:** [prompted-deep-discovery.md](../prompted-deep-discovery.md) — the canonical report.

## What each artifact answers

| Artifact | The question it answers |
|---|---|
| [prompted-deep-discovery.md](../prompted-deep-discovery.md) | What is this product, how does it work, and what is wrong with it? |
| [knowledge-base/index.md](knowledge-base/index.md) | What was established, how strongly, and where is the evidence? |
| [knowledge-base/evidence-catalog.md](knowledge-base/evidence-catalog.md) | What exactly supports a given claim, and at what location? |
| [knowledge-base/application-model.json](knowledge-base/application-model.json) | The machine-readable model: capabilities, nodes, flows, findings, unknowns |
| [source-model.json](source-model.json) | What do the documents claim, and which claims still hold? |
| [source-guide.md](source-guide.md) | Which sources can I trust, and what is each worth reading for? |
| [architecture/atlas.md](architecture/atlas.md) | How do the parts fit together, and where does a round get stuck? |
| [onboarding-guide.md](onboarding-guide.md) | I am new. What do I read, in what order, to change something safely? |
| [presentations/discovery-briefing.slides.md](presentations/discovery-briefing.slides.md) | Can someone brief this in ten minutes? |

## Reading paths

**If you have five minutes** — the executive summary of [the report](../prompted-deep-discovery.md).

**If you are deciding what to fix next** — the report's [conflicts, gaps and open questions](../prompted-deep-discovery.md#conflicts-gaps-and-open-questions), then the [findings table](knowledge-base/index.md#the-findings-that-matter).

**If you are joining the project** — [onboarding-guide.md](onboarding-guide.md), and read the warning at the top before you open `README.md`.

**If you are an agent picking this up cold** — [application-model.json](knowledge-base/application-model.json) is the authority. Ids are stable; capability statuses record the strongest support the evidence actually allows.

## Three things to know before reading anything else

1. **The two narrative documents describe a different product.** `README.md` and `GAME_DESIGN.md` specify Spotify, PostgreSQL and a React Native app. The build uses YouTube, SQLite and has no mobile app. The `.env.example` files, by contrast, are accurate.
2. **The round-deadline stall is fixed.** The prior discovery's top finding — a deadline computed but never enforced, stranding rounds on one absent player — is resolved by an interaction-driven `advanceIfExpired` seam with a durable host-notice system and a 13-test spec. Voting, however, still has no deadline.
3. **Most of the 21 group settings change nothing** — including `totalRounds` and `maxPlayers`, which are displayed as if they were limits, and six that never reach server behavior anywhere.

## Method and coverage

- **Corpus:** 84 source files, all read; no byte-identical duplicates; 1,661 generated Playwright artifacts excluded. Two `.env` files were confirmed present and deliberately never opened.
- **Approach:** five bounded source investigations — server engine, frontend/UX, test suite, docs/git history, identity — reconciled by a lead who re-verified every contested claim directly against the code.
- **Corrections made during reconciliation:** every cross-scout claim that would publish a number or a line citation was re-checked by the lead against the source. The round-stall finding, the settings-enforcement split and the new CSS regression were all confirmed directly before being written up.
- **Confidence:** findings marked from static analysis come from reading code, not from watching it run. No capability is marked "observed working", because the application was never driven by hand — it was read, and its suite was run.
- **Test evidence:** 65 tests across four browser projects (260 executions per run). At investigation time the `css-tokens` guard was failing on a real undefined-token regression; that is fixed in this refresh, so the package now describes a suite that is internally consistent with the tree.

## Known limits of this discovery

- The live Google sign-in path and the live YouTube API path are never exercised by the suite, by design, so neither is confirmed working here.
- Repository history is shallow relative to this work. Where a decision is not captured in a code comment, it usually cannot be dated or attributed.
- Diagrams are published as Mermaid source. No renderer was available and the method forbids installing one, so **the diagrams were not visually inspected**.
