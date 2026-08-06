---
id: plan-2026-07-27-glitter-corpus-live-rollout
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Complete the Glitter Discord Corpus Rollout

## Summary

The production corpus-capture workflow is complete and operating. The trusted
76,762-message seed is stored in SeaweedFS, the complete backfill and recovery
verification passed, and `glitter-corpus-daily` is active. Its latest scheduled
run published recovery-verified snapshot
`07d2998a-c2d0-4f15-aaab-c365bb103066` with 267 channels and 212,415 unique
messages.

Only final weekly context-refresh acceptance remains. After the OpenAI project
was topped up, the pinned rehearsal completed the four missing style cards
while reusing the nine immutable SeaweedFS artifacts. Two dry runs returned the
same proposal checksum, and the real run reused the same proposal without any
additional OpenAI calls. It opened human-review PR
[#1834](https://github.com/shepherdjerred/monorepo/pull/1834).

PR #1834's content is V1: a bounded recent-window rewrite with the coverage-
metadata defect recorded below. Rather than correcting and merging it, the
approved design in
`packages/docs/plans/2026-07-29_glitter-style-card-v2.md` fixes both issues by
construction (explicit coverage metadata, field-level patch retention across
the complete corpus). That plan's contract is: keep PR #1834 open only as the
source of three stronger descriptive baselines until its V2 replacement data
PR exists, then close #1834 as superseded. Keep
`glitter-context-refresh-weekly` paused until the V2 data PR is accepted and
merged, hosted CI and downstream smoke checks pass, and an operator
deliberately unpauses the schedule (see the operator-gated TODO below — the
unpause itself is not agent-verifiable).

## Implementation

- [x] Normalize and import the trusted ZIP as guild `208425771172102144` /
      `glitter-boys`, preserving the pinned 76,762-message projection.
- [x] Ship corpus correctness, recovery, Discord lease, inventory, canary, and
      retry-stable context-refresh hardening.
- [x] Deploy the Starlight Discord token and SeaweedFS-only storage projection
      to the production Temporal worker.
- [x] Upload and verify the immutable seed, approve inventory, run the canary,
      publish the complete backfill, and prove recovery retains every seed
      message.
- [x] Accept a manual daily cycle, verify the scheduled daily cycle, and
      deliberately activate `glitter-corpus-daily`.
- [x] Deploy the exact immutable Temporal worker image and verify ArgoCD,
      schedule state, metrics, and storage-integrity alerts.
- [x] Restore the Temporal worker OpenAI project's quota.
- [x] Run the snapshot-pinned fixed-time weekly dry run twice and require
      byte-identical outputs and proposal checksums.
- [x] Run the real refresh, inspect its sole PR, and complete pre-merge
      package-level smoke tests for the shared package, Birmel, Scout, and
      Glitter consumers.
- [x] Superseded: retired the V1 coverage-metadata correction and
      recent-window/cumulative-persona decision in favor of the approved V2
      design in `packages/docs/plans/2026-07-29_glitter-style-card-v2.md`,
      which fixes both by construction (explicit coverage metadata,
      field-level patch retention over the complete corpus). PR #1834 stays
      open only as the source of three stronger descriptive baselines; it is
      never corrected or merged.
- [x] Merged V2 implementation PR #1846
      (`56f28ee7`, "feat(glitter-context): generate V2 thick evidence
      contexts") through Buildkite and review, per
      `2026-07-29_glitter-style-card-v2.md`.
- [ ] Run the pinned V2 dry runs and promote the cached real run, per
      `2026-07-29_glitter-style-card-v2.md`.
- [ ] When the V2 data PR (all 13 cards) is open and pre-merge agent work is
      complete, set this plan to `status: awaiting-human` and
      `verification: human`.
- [ ] Add a `## Human Verification` scenario that asks the reviewer to inspect
      the generated V2 style cards for accurate, socially acceptable personas
      and explicitly accept or reject the proposal.
- [ ] After human acceptance, return this plan to `status: in-progress` with
      `verification: agent`, merge the V2 data PR, close PR #1834 as
      superseded, and run merged-main and production consumer smoke checks.
- [ ] Once those deterministic post-merge checks are green, hand off to the
      operator-owned unpause TODO
      (`packages/docs/todos/glitter-context-refresh-schedule-unpause.md`) —
      `packages/temporal/src/schedules/register-schedules.test.ts:281-287`
      asserts the schedule only unpauses via an explicit operator action, so
      this plan does not perform or agent-verify the unpause itself. After the
      operator unpauses it, verify its next action and observability, then
      archive this plan and its related TODOs.

## Live Rollout

- [x] Import the archive twice with the explicit guild identity and require
      byte-identical outputs: 164 CSVs, 98 channels, 76,762 unique messages, and
      zero duplicate IDs.
- [x] Upload the seed archive, manifest, projection, and channel partitions to
      SeaweedFS and verify every immutable object and receipt.
- [x] Approve the production inventory, including all 98 seed channel IDs.
- [x] Run the seed-backed canary and complete backfill.
- [x] Run recovery verification and prove every seed message is present in the
      canonical snapshot.
- [x] Run and verify manual and scheduled daily cycles, then deliberately
      activate `glitter-corpus-daily`.
- [x] Run the weekly context refresh twice as fixed-time dry runs and require
      identical snapshot/proposal checksums and outputs.
- [x] Run one real weekly refresh, inspect its sole PR, and complete pre-merge
      package-level smoke tests for the shared package, Birmel, Scout, and
      Glitter consumers.
- [x] Merged V2 implementation PR #1846.
- [ ] Run the pinned V2 dry runs and open the V2 data PR; complete current-head
      CI and subjective generated-content review before merging it, then close
      PR #1834 as superseded.
- [ ] Run merged-main and production consumer smoke checks after the V2 data
      PR merges.
- [ ] Hand off to the operator-owned
      `glitter-context-refresh-schedule-unpause` TODO to unpause
      `glitter-context-refresh-weekly`; after the operator unpauses it, confirm
      its next-run time and verify clean corpus/context observability.

## Verification

- Add focused tests for single-guild seed normalization, guild mismatch,
  retained deletion recovery, forum-parent visibility loss, concurrent/crashed
  leases, reset extensions, stale releases, stable weekly retries, proposal
  hashing, and canary terminal semantics.
- Run Temporal typecheck/test/lint, cdk8s tests and `check:1password`, affected
  repository verification, current-head Buildkite, and authoritative
  merged-main Buildkite.
- Completion requires the corrected 76,762-message seed stored in SeaweedFS, a
  published recovery-verified snapshot containing every seed message,
  a verified daily cycle, accepted weekly execution, and both schedules
  deliberately unpaused.

## Remaining

- [x] Implement and merge the Temporal hardening and member-lookup PRs.
- [x] Publish and merge the SeaweedFS storage/deployment wiring.
- [x] Upload and verify the trusted seed.
- [x] Approve inventory and complete the production canary.
- [x] Complete the full backfill and recovery verification.
- [x] Accept the daily workflow and unpause its schedule.
- [x] Superseded: retired the V1 coverage-metadata correction and
      recent-window/cumulative-persona decision in favor of the approved V2
      design (`2026-07-29_glitter-style-card-v2.md`), which fixes both by
      construction. PR #1834 stays open only as a descriptive-baseline source
      and is closed as superseded, never merged.
- [x] Merged V2 implementation PR #1846.
- [ ] Run the pinned V2 dry runs and open the V2 data PR (all 13 cards).
- [ ] Complete the V2 data PR's current-head CI, then transition this plan to
      `awaiting-human` / `verification: human` with the observable
      generated-content review scenario.
- [ ] Complete the subjective human review before merging the V2 data PR.
- [ ] Return this plan to `in-progress` / `verification: agent`, merge the V2
      data PR, close PR #1834 as superseded, and complete merged-main and
      production consumer smoke checks.
- [ ] Hand off to the operator-owned
      `glitter-context-refresh-schedule-unpause` TODO for the weekly-workflow
      unpause and acceptance.
- [ ] Complete and archive this plan and the related TODOs.

## Assumptions

- Both archive roots belong to guild `208425771172102144`; matching embedded
  `thread.guild_id` values are the independent evidence.
- No production corpus snapshot exists, so persisted schemas can be corrected
  before first publication without migration.
- The initial denylist is empty; inventory approval is the final scope
  authority.
- Attachment metadata remains included; attachment bodies remain excluded.
