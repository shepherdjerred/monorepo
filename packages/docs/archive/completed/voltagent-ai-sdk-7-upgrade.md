---
id: voltagent-ai-sdk-7-upgrade
type: todo
status: complete
board: false
origin: packages/docs/archive/completed/2026-07-29_dependency-upgrade-program.md
---

# Upgrade VoltAgent consumers to AI SDK 7 and OpenAI provider 4

## Context

The rest of the 2026-07-29 dependency program shipped. This coordinated migration remains externally blocked because VoltAgent's stable core is still 2.9.0 and declares AI SDK 6 peer compatibility; VoltAgent 3 remains prerelease.

## Resolution

Birmel 3.0 removed VoltAgent and its libSQL memory adapter in favor of a direct
AI SDK 6 runtime. The coordinated VoltAgent/AI SDK 7 peer upgrade is therefore
no longer applicable; future AI SDK upgrades can follow the ordinary package
upgrade path without waiting on VoltAgent releases.

## Comment Log

### 2026-08-02 — split from completed dependency program

- PRs #1837, #1838, #1840, #1842, and #1843 all merged with green exact-head Buildkite checks.
- The registry gate is unchanged: stable VoltAgent core remains 2.9.0 and version 3 remains prerelease.

### 2026-08-08 — resolved by Birmel 3.0

- Archived after the only VoltAgent consumer and its dependency constraints
  were removed.
