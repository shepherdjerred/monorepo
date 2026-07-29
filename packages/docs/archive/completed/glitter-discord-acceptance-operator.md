---
id: glitter-discord-acceptance-operator
type: todo
status: complete
board: false
origin: packages/docs/archive/completed/2026-07-26_glitter-discord-source-of-truth.md
---

# Provision and acceptance-test the Glitter Discord corpus pipeline

## Context

The Discord corpus pipeline is provisioned and accepted in production. Storage
was simplified to SeaweedFS before rollout; the obsolete R2 mirror was never
required.

## Remaining

- [x] Populate the approved 1Password fields, refresh the non-secret snapshot,
      and record explicit channel/thread scope approval.
- [x] Run the controlled Discord canary, trusted-seed import, full backfill,
      daily capture, Temporal, SeaweedFS publication, and recovery acceptance
      sequence.
- [x] Record checksums and outcomes, then unpause only
      `glitter-corpus-daily`.

## Closure Evidence

- The latest scheduled daily run published snapshot
  `07d2998a-c2d0-4f15-aaab-c365bb103066` with 267 complete channels, 212,415
  unique messages, and SHA-256
  `04b53f7bbf0a3186297d14e5522aa2edc0992fb7def721e4e6faa1f68ef5b776`.
- The production worker independently recovered and verified the same snapshot.
- `glitter-corpus-daily` is active. The separate quota-gated
  `glitter-context-refresh-weekly` acceptance remains tracked in
  `packages/docs/todos/glitter-corpus-worker-credentials.md`.

## Comment Log

### 2026-07-27 — split from active implementation plan

- Privileged credentials and live Discord/storage operations are operator work, not human UAT or agent verification.

### 2026-07-29 — completed

- Provisioned the Discord and SeaweedFS credentials, approved scope, seeded and
  backfilled the corpus, verified recovery, and activated the daily schedule.
- Archived this completed operator-acceptance item. The OpenAI quota boundary is
  tracked separately and does not block corpus capture.
