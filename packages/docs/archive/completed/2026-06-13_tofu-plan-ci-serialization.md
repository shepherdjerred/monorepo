---
id: reference-completed-2026-06-13-tofu-plan-ci-serialization
type: reference
status: complete
board: false
---

# Tofu-plan CI serialization fix

## Context

Green PRs touching `packages/homelab` (e.g. #1155) sat "pending" for ~1 hour even with
all real checks passing. Two compounding causes:

1. Each PR build runs 3 OpenTofu **plan** jobs (Cloudflare / GitHub / SeaweedFS), each
   with an **org-wide `concurrency: 1`** group (`scripts/ci/src/steps/tofu.ts`). With
   ~10 branches building at once, every branch's plan jobs serialized into 3 single-slot
   FIFO queues. A build can't finish — its top-level `buildkite/monorepo/pr` status stays
   PENDING → PR shows UNSTABLE — until its plans reach the front of the line.
2. The plan group ran on **any** homelab change (`pipeline-builder.ts:339`), not on
   tofu-file changes — so cdk8s-only PRs ran (and queued behind) three plans that yield
   no signal for them.

**Why the lock was unnecessary for plan:** `tofu plan` never writes state
(`.dagger/src/release.ts` runs `tofu plan -input=false -detailed-exitcode`), and the S3
backends configure no locking — no `dynamodb_table`, no `use_lockfile`
(`packages/homelab/src/tofu/*/backend.tf`). So the `concurrency: 1` on plan guarded
nothing; concurrent plans can't corrupt state and S3 reads are atomic. The `apply` step
(main-only) keeps its concurrency — applies DO write state and that group is the only
thing serializing same-stack applies.

## Changes

| File                                                | Change                                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/ci/src/steps/tofu.ts`                      | Removed `concurrency`/`concurrency_group` from `tofuPlanStep` (apply unchanged)                                                       |
| `scripts/ci/src/lib/types.ts`                       | Added `tofuChanged` to `AffectedPackages`                                                                                             |
| `scripts/ci/src/change-detection.ts`                | `checkTofuChanges()` (path prefix `packages/homelab/src/tofu/`); threaded through the 3 result builders; exported `_checkTofuChanges` |
| `scripts/ci/src/pipeline-builder.ts`                | Gate plan group on `buildAll \|\| tofuChanged` (was `homelabChanged`)                                                                 |
| `scripts/ci/src/__tests__/pipeline-builder.test.ts` | Narrowed concurrency test to apply-only; assert plan steps have no concurrency; added gating tests; fixtures updated                  |
| `scripts/ci/src/__tests__/change-detection.test.ts` | Added `tofuChanged` detection tests                                                                                                   |

`tofuChanged` is computed from the raw changed-file list (not the transitive package
closure), mirroring the existing `cooklangChanged` / `ciImageChanged` pattern. `.dagger/`
and `scripts/ci/` are in `INFRA_DIRS`, so changes to the tofu Dagger logic or the
generator still run the plan via `buildAll`.

## Verification

- `cd scripts/ci && bun test` → 243 pass.
- `bun run typecheck` → clean.
- `bun scripts/check-dagger-hygiene.ts` → no violations.

## Out of scope

- Per-stack plan gating (run only the changed stack's plan) — possible later optimization.
- `use_lockfile = true` on the four S3 backends for real apply-time state locking, which
  would let even the apply serialization relax.

## Session Log — 2026-06-13

### Done

- Implemented both fixes in worktree `feature/tofu-plan-parallelize`; 6 files changed.
- Tests/typecheck/hygiene all green. Opened PR #1160.

### Remaining

- Confirm post-merge that homelab cdk8s-only PRs skip `homelab-tofu-plan` and that
  tofu-source PRs still run all three plans in parallel without queuing.

### Caveats

- The general "BK slow" funnel (`max-in-flight: 20`, Kueue 7500m on single-node torvalds)
  is a separate constraint not addressed here — this PR only removes the tofu-plan
  serialization and wasteful plan runs.
