---
id: voltagent-ai-sdk-7-upgrade
type: todo
status: planned
board: true
verification: agent
disposition: blocked
origin: packages/docs/archive/completed/2026-07-29_dependency-upgrade-program.md
---

# Upgrade VoltAgent consumers to AI SDK 7 and OpenAI provider 4

## Context

The rest of the 2026-07-29 dependency program shipped. This coordinated migration remains externally blocked because VoltAgent's stable core is still 2.9.0 and declares AI SDK 6 peer compatibility; VoltAgent 3 remains prerelease.

## Remaining

- [ ] Wait for stable VoltAgent core, LibSQL memory, and logger releases whose peer ranges support AI SDK 7 and provider-utils 5.
- [ ] Start the repository's 30-day dependency-stability window from those stable releases.
- [ ] Revalidate against the released APIs, then update `ai`, `@ai-sdk/openai`, VoltAgent packages, and required schema types in one coordinated PR.
- [ ] Migrate nullable reasoning summaries and other type/API changes, then run real provider-backed end-to-end acceptance.

## Comment Log

### 2026-08-02 — split from completed dependency program

- PRs #1837, #1838, #1840, #1842, and #1843 all merged with green exact-head Buildkite checks.
- The registry gate is unchanged: stable VoltAgent core remains 2.9.0 and version 3 remains prerelease.

## Session Log — 2026-08-02

### Done

- Isolated the only externally blocked phase from the completed dependency-upgrade program.

### Remaining

- Recheck the stable VoltAgent releases and begin the migration only after the compatibility and stability gates open.

### Caveats

- Prerelease compatibility evidence does not authorize starting the production migration.
