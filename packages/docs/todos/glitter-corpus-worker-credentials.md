---
id: glitter-corpus-worker-credentials
type: todo
status: in-progress
board: true
verification: agent
disposition: active
source_marker: false
---

# Complete quota-gated Glitter context refresh acceptance

The Discord and SeaweedFS credentials are provisioned in 1Password, wired into
the deployed Temporal worker, and covered by the committed non-secret vault
snapshot. The trusted seed, full backfill, daily capture, recovery verification,
and observability gates all pass. `glitter-corpus-daily` is active in production.

The Temporal worker's OpenAI project was topped up without changing its
credential. The pinned production rehearsal then reused nine existing
SeaweedFS generation artifacts and generated only the four missing style cards.
Two dry runs returned the same proposal checksum, and the real run opened
human-review PR [#1834](https://github.com/shepherdjerred/monorepo/pull/1834)
without making additional OpenAI calls.

## Remaining

- [x] Restore usable quota for the project that owns the Temporal worker's
      existing `OPENAI_API_KEY`.
- [x] Rerun the fixed-time dry run twice against snapshot
      `dbb59f00-3f6b-4cab-a87c-6d8a65e21d62` at SHA-256
      `e4253d203408efe65f4ad4199ccaebf3c83df68a182ce816865f6abc43837ff9`
      and require complete output equality.
- [x] Run the real refresh with the same pin, inspect its sole PR, and complete
      pre-merge package-level smoke tests for the shared package, Birmel, Scout,
      and Glitter consumers.
- [x] Superseded: retired the V1 coverage-metadata correction and
      recent-window/cumulative-persona decision in favor of the approved V2
      design in `packages/docs/plans/2026-07-29_glitter-style-card-v2.md`,
      which fixes both by construction. PR #1834 stays open only as a
      descriptive-baseline source and is closed as superseded, never merged.
- [x] Merged V2 implementation PR #1846 (`56f28ee7`).
- [ ] Run the pinned V2 dry runs and promote the cached real run.
- [ ] When the V2 data PR (all 13 cards) is open and pre-merge agent work is
      complete, set this TODO to `status: awaiting-human` and
      `verification: human`.
- [ ] Add a `## Human Verification` scenario: review the generated V2 style
      cards for accurate, socially acceptable personas and explicitly accept
      or reject the proposal.
- [ ] After human acceptance, return this TODO to `status: in-progress` with
      `verification: agent`, merge the V2 data PR, close PR #1834 as
      superseded, and run merged-main and production consumer smoke checks.
- [ ] Hand off to the operator-owned
      `glitter-context-refresh-schedule-unpause` TODO for the weekly-schedule
      unpause — `packages/temporal/src/schedules/register-schedules.test.ts:281-287`
      asserts the schedule only unpauses via an explicit operator action, so
      this document does not perform or agent-verify that step. After the
      operator unpauses it, complete and archive this TODO and the live
      rollout plan.

## Comment Log

- 2026-07-26 — Filed from PR #1700 review (Codex P1 "Wire the required corpus
  credentials into the worker"). Code wiring was drafted and verified to fail
  `check:1password` because the 1P fields do not yet exist; reverted to keep CI
  green. Schedules already fail-safe (auto-paused as unconfigured).
- 2026-07-29 — Discord and SeaweedFS credentials, worker wiring, deployment,
  seed, backfill, daily schedule, recovery, and observability are complete.
  Removed obsolete R2 and provisioning tasks. The only remaining operator
  boundary is OpenAI project quota; weekly refresh remains deliberately paused.
- 2026-07-29 — Re-audited the live Ready worker, ArgoCD application, and both
  schedules, then retried the exact fixed-time, snapshot-pinned dry run as
  workflow `glitter-context-refresh-manual-a3f6ec23-cb6d-45db-9766-f75009766b00`.
  Both configured attempts again reached OpenAI and failed closed on HTTP 429
  `insufficient_quota`; no branch, PR, or context mutation occurred.
- 2026-07-29 — Probed the credential directly from the deployed worker without
  exposing it. The configured key successfully read the `gpt-5.6-sol` model,
  while a minimal completion failed with HTTP 429 `insufficient_quota`
  (`req_3b7c0ed562be4905ae4c68e65f2e71ba`). Kubernetes identifies the source as
  1Password item `mjgnqqh37jxyzseqrddde2jgaq`, version `19`,
  `OPENAI_API_KEY`. The API returned no project or organization header, and a
  metadata-only 1Password lookup timed out; the operator must identify that
  key's owning project in the OpenAI dashboard and restore quota there.
- 2026-07-29 — The operator topped up the existing OpenAI project. The next
  pinned dry run reused nine generation artifacts, generated the four missing
  cards, and completed with proposal SHA-256
  `9f558af01bf18f2082499c61cd400b44b27bb1e0f93e878978c1cf785e582538`.
  A second dry run returned the same result with zero OpenAI calls. The real
  run reused the same proposal with zero OpenAI calls and opened PR #1834.
