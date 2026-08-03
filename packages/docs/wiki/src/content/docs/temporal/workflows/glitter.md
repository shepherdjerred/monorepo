---
title: Glitter workflows
description: Durable Discord corpus capture and a cost-capped LLM context refresh — the most guardrailed workflows in the fleet.
---

Glitter needs two things: a complete, verifiable archive of a Discord guild's
message history, and periodically refreshed per-person context distilled from
it. Both run on dedicated task queues (Discord rate limits and long LLM runs
must not starve other workflows), and both schedules were **created paused**
— each required explicit operator approval before its first real run.

## Corpus capture (`glitter-corpus`)

Daily 04:15. Captures the guild's history to S3 as an immutable,
content-addressed corpus: every page and manifest is written once under its
sha256, so retries re-read rather than corrupt, and nothing is ever
overwritten.

- **Bootstrap is operator-gated.** An inventory run lists channels and scope
  decisions as an immutable object; the operator approves it by key+checksum
  before the full backfill may run (`bun run glitter:operate`).
- **Backfill verifies itself.** Each channel is traversed backward and
  forward independently, and the two traversals are checked against each
  other for completeness.
- **Daily runs are incremental.** Each run re-fetches only the last 7 days
  and merges onto the prior snapshot — cheap, and tolerant of edits and
  late-arriving messages. After 6 consecutive overlap runs a channel is fully
  re-backfilled, bounding how far accumulated drift can go.
- **One request per second, globally.** A compare-and-swap lease object in S3
  serializes Discord access across every concurrent activity.

## Context refresh (`glitter-context-refresh`)

Monday 11:00. Distills the verified corpus into per-person style cards and
evidence-cited relationship history for `packages/glitter-context`, then
opens a human-reviewed PR (never auto-merged). This is the fleet's most
budget-conscious workflow:

- **Hard cost cap** — the run carries `maxEstimatedCostUsd` (default $10);
  a preflight estimate, a per-call authorization check, and a post-call
  ceiling check all fail the run non-retryably when exhausted. A completion
  that returns without usage data is also non-retryable — it will not risk
  re-charging.
- **Two-stage generation** — gpt-5.6-luna extracts over corpus chunks,
  gpt-5.6-sol synthesizes; every relationship change must cite exact message
  IDs.
- **Retries don't re-pay** — generation artifacts are cached in S3 by
  content, so a retried run reuses paid work.
- **Output is fenced** — the clone is fully validated (typecheck, test,
  lint, build) and any changed path outside the allowlist rejects the run.

Sources: [`glitter-corpus.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/workflows/glitter-corpus.ts),
[`glitter-context-refresh.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/workflows/glitter-context-refresh.ts);
operations runbook lives in the working docs.
