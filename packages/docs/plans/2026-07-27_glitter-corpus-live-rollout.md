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
[#1834](https://github.com/shepherdjerred/monorepo/pull/1834). Keep only
`glitter-context-refresh-weekly` paused until that generated content is
accepted and merged, hosted CI and downstream smoke checks pass, and the
schedule is deliberately unpaused.

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
- [ ] Correct generated-context PR #1834's coverage metadata so verified-corpus
      message counts are explicitly distinct from the bounded 200-message model
      evidence sample; regenerate and re-review affected cards if that correction
      changes generated content.
- [ ] Complete #1834's current-head Buildkite after the metadata correction.
- [ ] When pre-merge agent work is complete, set this plan to
      `status: awaiting-human` and `verification: human`.
- [ ] Add a `## Human Verification` scenario that asks the reviewer to inspect
      the generated style cards for accurate, socially acceptable personas and
      explicitly accept or reject the proposal.
- [ ] After human acceptance, return this plan to `status: in-progress` with
      `verification: agent`, merge #1834, and run merged-main and production
      consumer smoke checks before allowing the weekly schedule to be unpaused.
- [ ] Deliberately unpause `glitter-context-refresh-weekly`, verify its next
      action and observability, then archive this plan and its related TODOs.

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
- [ ] Correct #1834's coverage metadata, then complete current-head CI and
      subjective generated-content review before merging it.
- [ ] Run merged-main and production consumer smoke checks after #1834 merges.
- [ ] Deliberately unpause `glitter-context-refresh-weekly`, confirm its
      next-run time, and verify clean corpus/context observability.

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
- [ ] Correct #1834's coverage metadata to distinguish verified-corpus message
      counts from the bounded 200-message model evidence sample.
- [ ] Complete #1834's current-head CI, then transition this plan to
      `awaiting-human` / `verification: human` with the observable
      generated-content review scenario.
- [ ] Complete the subjective human review before merging PR #1834.
- [ ] Return this plan to `in-progress` / `verification: agent`, merge #1834,
      and complete merged-main and production consumer smoke checks.
- [ ] Unpause and accept the weekly workflow.
- [ ] Complete and archive this plan and the related TODOs.

## Assumptions

- Both archive roots belong to guild `208425771172102144`; matching embedded
  `thread.guild_id` values are the independent evidence.
- No production corpus snapshot exists, so persisted schemas can be corrected
  before first publication without migration.
- The initial denylist is empty; inventory approval is the final scope
  authority.
- Attachment metadata remains included; attachment bodies remain excluded.

## Session Log — 2026-07-27

### Done

- Mirrored the approved implementation plan into the repository.
- Imported the trusted archive twice with explicit single-guild identity;
  both runs produced projection SHA-256
  `ae61f1659196d176b343dc40f19741b0df73be01466f61c2da7561f43a7e08f8`,
  164 CSVs, 98 channels, 76,762 unique messages, and zero duplicates.
- Implemented the Temporal hardening: single-guild seed validation, retained
  full-refresh baselines, forum-parent visibility checks, a global in-flight
  Discord request lease, retry-stable context refresh identity/checksums, and
  the context-refresh operator command.
- Added focused regression coverage and passed the Temporal package's 707-test
  suite, typecheck, lint, documentation checks, and affected repository
  verification.
- Confirmed the existing SeaweedFS credential fields are populated and the
  three new R2 credential fields are not yet present in the worker's 1Password
  item.
- Published the hardening as draft PR
  [#1750](https://github.com/shepherdjerred/monorepo/pull/1750); its Buildkite
  verify, Semgrep, drift, Playwright, Trivy, and observability gates passed
  against commit `7fd8369d61888a84869b010cc45eeeab5e02db18`.
- Prepared the stacked homelab wiring and verified the synthesized deployment
  maps the Discord, SeaweedFS, and R2 settings to the intended literals and
  secret keys. Homelab build, typecheck, and lint pass.
- Switched the wiring to the existing production `Starlight` credential,
  confirmed that bot is a member of the Glitter guild with Message Content
  enabled, and completed a live read-only inventory: 263 included entries and
  14 entries without readable history.
- Fixed the live-discovered Discord member lookup bug by addressing the guild
  member with the bot snowflake instead of the unsupported `@me` placeholder;
  focused tests, typecheck, and lint pass.

### Remaining

- Grant Starlight View Channel plus Read Message History on seed channel
  `1101640275220238426` (`league-of-legends`) and decide whether the other 13
  currently unreadable channels belong in the approved corpus scope.
- Populate the three R2 credential fields, refresh the hashed vault snapshot, and
  require `check:1password` to pass before committing and publishing PR 2.
- Finish PR #1750's remaining Buildkite image/review gates, merge the two-PR
  stack after all current-head gates pass, then execute the live rollout
  checklist above.

### Caveats

- Credential provisioning and inventory/full-scrape approval are explicit
  operator gates; no secret values belong in this document or chat.
- The prepared homelab change is intentionally uncommitted because the offline
  vault check proves all three new R2 fields are absent from the committed
  snapshot.

## Session Log — 2026-07-29 (acceptance-gate correction)

### Done

- Separated completed pre-merge package smoke tests from the still-required
  merged-main and production consumer smoke checks.
- Added the uncompleted metadata correction that must distinguish verified-corpus
  coverage from the bounded 200-message model evidence sample before acceptance.
- Recorded the staged handoff from pre-merge agent work to subjective human
  acceptance, followed by post-merge agent verification.

### Remaining

- Correct #1834's coverage metadata and complete its current-head Buildkite,
  then obtain subjective human acceptance before merging it.
- Return the plan to agent verification after acceptance, merge #1834, and run
  merged-main plus production consumer smoke checks.

### Caveats

- PR #1834's current Buildkite #7145 failed in the bootstrap pipeline-upload
  job with a `stack_error`; no repository verification job ran.
- This documentation change does not mark generated content, CI, merged-main
  smoke checks, production smoke checks, or schedule acceptance complete.

## Session Log — 2026-07-29 (human-review ordering correction)

### Done

- Removed the circular requirement for merged-main and production smoke checks
  before the generated-content review that must precede merge.
- Made the workflow phases explicit: pre-merge agent gates, human acceptance,
  then post-merge agent verification.

### Remaining

- Correct #1834's coverage metadata and complete its current-head CI.
- Transition this plan to `awaiting-human` / `verification: human`, complete the
  observable generated-content review, then return it to agent verification for
  merge and post-merge smoke checks.

### Caveats

- The existing pre-merge package smoke evidence remains complete.
- PR #1834, merged-main checks, production consumer smokes, weekly-schedule
  unpause, and final acceptance all remain incomplete.

## Session Log — 2026-07-28

### Done

- Confirmed the Discord Customize option `League of Legends` maps only to the
  `Glitter League` role `962497446943027211`, with no direct channel
  subscriptions.
- Assigned `Glitter League` to Starlight through Discord's guild-member role
  API and verified both the resulting member role and an HTTP 200 message
  history read from `league-of-legends`.
- Re-ran live inventory with the corrected bot member lookup: 267 entries are
  included, 17 are non-message channels, and 13 lack readable history. None of
  the 13 unreadable channels occur in the trusted seed's 98-channel scope.
- Merged the hardening PR #1750 and the member-lookup correction PR #1752 after
  current-head Buildkite and Codex review passed.
- Confirmed both the `glitter-discord-corpus` SeaweedFS bucket and the
  previously planned R2 bucket exist; selected SeaweedFS as the sole canonical
  corpus store before the first production publication.
- Removed the R2 credential requirement and replaced the dual-mirror persisted
  contract with checksum-verified single-store SeaweedFS objects.
- Wired the Starlight token plus the existing Temporal worker's SeaweedFS
  endpoint and credentials into the worker deployment, with focused synth
  coverage proving no Glitter R2 variables remain.
- Replaced the mirror-divergence metric, alert, and dashboard panel with
  SeaweedFS storage-integrity monitoring.
- Addressed the PR review finding by making required object reads distinct from
  optional cache probes. Missing manifests, pages, seed partitions, baselines,
  snapshots, inventories, and projections now increment the storage-integrity
  counter, with an S3-level regression test covering required and optional 404s.
- Passed focused Temporal tests, the full 709-test Temporal suite, the full
  253-test cdk8s suite, typechecks, targeted lint, `check:1password`, and
  storage/deployment schema checks. The post-review Temporal package test,
  typecheck, and lint commands also pass.
- Merged SeaweedFS deployment PR #1758 at `55dfc50ce`; authoritative main
  Buildkite #6707 passed every applicable verification, image, release, and
  ArgoCD lane.
- Verified the live worker deployment projects Starlight plus all required
  SeaweedFS fields with no R2 variables, and confirmed both Glitter schedules
  remain paused.
- Confirmed #6707 pushed the Temporal worker image digest
  `sha256:de51c6c4a386ea06fc8621ba2e1ceffad49b47dc24faade1794848d4058fead2`;
  its automated version PR #1756 passed Buildkite #6708 and merged.
- Added explicit TLS support to the Glitter operator CLI after live acceptance
  proved Kubernetes port-forwarding cannot reach the server's pod-IP-only
  listener. Updated the runbook to use the healthy Tailscale ingress.
- Verified main image `2.0.0-6707` at digest
  `sha256:de51c6c4a386ea06fc8621ba2e1ceffad49b47dc24faade1794848d4058fead2`
  rolled out and all three Glitter worker queues reached `RUNNING`.
- Uploaded the pinned seed to SeaweedFS twice from the credentialed production
  worker. Both imports produced the approved archive and projection checksums,
  164 CSVs, 98 channels, 76,762 unique messages, and zero duplicates.
- Verified the seed prefix contains exactly 101 immutable objects totaling
  167,246,402 bytes: the archive, manifest, projection, and 98 channel
  partitions.
- Ran production inventory through Temporal over TLS. Inventory
  `8f115f88e68f6ae735d38907357e0fc96e35709927c2e8c0d4f15024d833af23`
  contains 267 included entries, 17 non-message exclusions, and 13
  no-history-permission exclusions; the approved canary channel is included.
- Used the canary to find and fix four live-only acceptance defects before
  publication: blank denylist presence was treated as missing, the 100-page
  operator ceiling was too low for the chosen channel, and Discord returns
  each `after` page newest-to-oldest rather than oldest-to-newest. The
  verification pass also had to advance its forward cursor from the first
  (largest) message in that descending page.
- Converted traversal safety-ceiling failures to non-retryable Temporal
  application failures so an incomplete traversal terminates explicitly
  instead of retrying its workflow task forever.
- Merged live-acceptance hardening PR
  [#1763](https://github.com/shepherdjerred/monorepo/pull/1763) at
  `6dcc9cd8e`; its current-head Buildkite #6722 passed every required PR gate.
- Followed the authoritative merged-main builds through a concurrent-main
  cancellation. Buildkite #6724 selected changes from the last green main
  `55dfc50ce`, passed full verify and the other pre-image gates, and then
  exposed a Buildx filesystem-entitlement failure in the production image
  push.
- Updated the shared image bake runner to grant the pinned generated Caddyfile
  read entitlement during both smoke and production pushes. Added focused
  fail-fast coverage for the required path; the seven-test bake suite,
  root-script typecheck, lint, and formatting checks pass.
- Merged the entitlement correction as PR
  [#1765](https://github.com/shepherdjerred/monorepo/pull/1765). Authoritative
  main Buildkite #6728 then caught that importing the executable bake runner
  from its unit test pulled orchestration code into the strict script-coverage
  set and reduced measured coverage below 90%.
- Moved the pure entitlement argument builder into the existing covered
  migration core, so the regression test no longer imports executable
  orchestration while the production runner retains the same fail-fast
  behavior.
- Merged the coverage-safe image fix as PR
  [#1766](https://github.com/shepherdjerred/monorepo/pull/1766) after Buildkite
  #6731 passed, then followed main Buildkite #6733 through image publication
  and the generated version PR #1767 through Buildkite #6735 and merge.
- Verified ArgoCD deployed worker image `2.0.0-6733` at digest
  `sha256:e922c0b1fdcf96a1f0db89566dc09a1dabe25de3c799c834052e9bd70a2d69d2`;
  the deployment reached generation 219 with all Glitter queues polling and
  both schedules still paused at their intended operator gates.
- Completed the production canary for channel `1101640275220238426`. Workflow
  `glitter-corpus-canary-1101640275220238426-b692abae-6668-43cf-9385-e0e09becf7a7`
  verified 10,288 unique messages and wrote immutable channel state
  `594dddcb04598d5131836379c5193fc06f8131ddd20fbf300851810f0d949c66`
  without publishing the canonical latest pointer.
- Ran the approved 267-channel full backfill. It completed 248 children without
  a child failure, then failed closed while reconciling the original guild
  channel; no canonical snapshot or latest pointer was published.
- Traced the verifier conflict for message `1282240201992966155` through all
  1,179 stored live page objects and its trusted seed partition. The backward
  and forward REST observations agree, while the archive contains a different
  user mention for the same bot-authored message ID and timestamp and Discord
  reports no `edited_timestamp`.
- Added a narrow projection rule: at an equal message version, live Discord
  REST may supersede trusted-seed content drift only when every other immutable
  field agrees. Same-source content conflicts and all non-content immutable
  conflicts still fail closed. Added order-independent initial projection and
  daily baseline merge regressions using the production evidence.
- Passed the focused 12-test projection suite, targeted lint and formatting,
  Temporal typecheck, and the complete Temporal test, lint, and typecheck
  surface. The affected repository verification also passed all 30 applicable
  gates, including 736 Temporal tests, the clean-clone rehearsal, script
  coverage, markdown, secret scanning, and quality checks.

### Remaining

- Publish, merge, and deploy the narrow seed-content drift correction.
- Rerun the full approved backfill, publish its canonical snapshot, and pass
  recovery verification including all 76,762 trusted seed messages.
- Run and verify one manual daily cycle, then deliberately unpause the daily
  schedule.
- Complete the two fixed-time weekly dry runs, real weekly refresh, downstream
  smoke checks, and deliberately unpause the weekly schedule.
- Mark this plan complete and archive it only after both schedules have passed
  acceptance.

### Caveats

- Direct role assignment produces the required channel access but does not
  necessarily mark the member-facing Customize option as selected in Discord's
  client state.
- The 13 unreadable channels remain excluded by the current live permissions;
  because none is part of the trusted seed, they do not block seed preservation.
- The affected aggregate passed 39 of 40 gates; its only failure was Bun
  extracting `@openai/codex` while another worktree wrote the shared download
  cache. The published tarball was independently downloaded and validated, and
  the failed clean-clone rehearsal passed end to end when rerun with an isolated
  Bun cache.
- Main Buildkite #6709 deployed the intended Temporal image but failed its
  final app-tree health wait because Loki and intentionally retained Jellyfin
  resources remained out of sync. Deleting the tracked Jellyfin resources is a
  separate destructive operator task and is not authorized by this rollout.
- The first canary was terminated after its deliberately low 100-page ceiling
  failed; the second failed closed on the live forward-page ordering mismatch.
  Neither run published a canonical snapshot.
- The first full backfill parent
  `glitter-corpus-backfill-6a0a9a35-3209-4171-bb50-19da7577fb48` failed after
  248 of 267 children completed. Its immutable page evidence remains in
  SeaweedFS, but the failed parent published neither a complete snapshot nor a
  latest pointer.
- The source-authority exception is intentionally limited to content drift
  between trusted seed and Discord REST at the same version. It does not
  reconcile two disagreeing REST observations, two disagreeing seed
  observations, or drift in identity, timestamps, type, flags, attachments,
  references, or TTS.

## Session Log — 2026-07-28 (rollout recovery)

### Done

- Fixed the PVC admission policy's absent-field CEL expression, added focused
  synthesis coverage, and verified the generated policy with a live
  API-server dry run.
- Merged the admission fix as PR
  [#1773](https://github.com/shepherdjerred/monorepo/pull/1773) at
  `e0b7f21a5` after Buildkite #6752 and the current-head review gates passed.
- Traced authoritative main Buildkite #6753 to a webring TypeDoc failure:
  Markdown-It's compatibility patches imported Linkify 6 but still called its
  removed `pretest()` method.
- Completed the Linkify 6 migration for all three patched Markdown-It versions
  and added TypeDoc generation to the webring test gate.
- Reproduced and fixed an Astro 6 filesystem race by serializing `sjer.red`
  typecheck before build. A forced cold sequence passed, followed by all 217
  affected repository verification tasks.
- Published the main-CI recovery as PR
  [#1774](https://github.com/shepherdjerred/monorepo/pull/1774).

### Remaining

- Pass the amended PR #1774 current-head review and Buildkite gates, merge it,
  and require the replacement authoritative main build to deploy and
  reconcile successfully.
- Resume the failed production backfill only after Temporal Postgres and the
  ArgoCD application are healthy, then finish the daily and weekly acceptance
  gates from this plan.

### Caveats

- Both production Glitter schedules remain paused; no seed or snapshot data was
  mutated during the infrastructure and main-CI recovery.
- Buildkite #6753 failed before its GitOps sync, so the admission fix is merged
  but is not accepted as live until the replacement main build completes.

## Session Log — 2026-07-29 (weekly acceptance repair)

### Done

- Reconciled the corrected PVC policy, restarted the Postgres operator to
  requeue all four clusters, and passed authoritative main Buildkite #6761 with
  the Temporal application Synced and Healthy.
- Reset the failed full backfill at event 2248. The replacement run
  `59ac97b7-4f70-43a9-a78f-1027c0331e3a` completed all 267 approved channels
  and published snapshot `c8311866-63cc-48c0-b258-cdcde388fa22`.
- Rebuilt the published graph from immutable SeaweedFS objects and verified
  212,315 unique messages plus all 76,762 trusted seed observations across all
  98 seeded channels.
- Completed manual daily run
  `019fabf3-b2dc-7d5e-8a6a-41f6c16ffece`, published recovery-verified snapshot
  `dbb59f00-3f6b-4cab-a87c-6d8a65e21d62` with 212,373 unique messages, and
  deliberately unpaused `glitter-corpus-daily`.
- Ran the first fixed-time weekly dry run. It failed closed before producing a
  proposal because the model-facing `StyleCardSchema` contained an optional
  field and an open record that OpenAI strict Structured Outputs reject.
- Added a dedicated strict model-response schema with required nullable
  concerns and an array representation for league entries, while preserving
  the existing persisted style-card schema. Added an SDK schema-conversion
  regression.
- Passed the focused schema regression, the full 738-test Temporal suite, and
  all 30 tasks in `bun run verify -- --affected`, including the schedule
  consumer-clone rehearsal.
- Merged the repair through PR
  [#1792](https://github.com/shepherdjerred/monorepo/pull/1792); authoritative
  main Buildkite #6833 built and pushed the repaired worker image.
- Traced the image-pin PR #1789 failure to two deterministic root-script lint
  errors that a prior cache hit had hidden, then corrected the HCL parser
  control flow and replaced the high-entropy test fixture.

### Remaining

- Publish and merge the root-script lint repair, then complete the repaired
  worker image-pin deployment through PR #1789.
- Rerun both fixed-time dry runs and require byte-identical proposal outputs.
- Run the real weekly refresh, review its PR or no-diff result, smoke-test all
  three consumers, and deliberately unpause the weekly schedule.
- Complete and archive this plan and the related rollout documents.

### Caveats

- The failed weekly dry run exhausted its two activity attempts and created no
  branch, commit, PR, or context-file mutation.
- `glitter-context-refresh-weekly` remains paused until both dry runs, the real
  run, and downstream smoke checks pass.
- The repaired worker image exists at
  `sha256:ffb5e5cb47b21e65f41385c3c4660de367ff4a12a18f26df1582a25af7086af1`,
  but production remains on the prior image until the GitOps pin merges.

## Session Log — 2026-07-29 (deterministic production acceptance)

### Done

- Preserved canonical style-card authors across refreshes and merged the
  regression through PR
  [#1798](https://github.com/shepherdjerred/monorepo/pull/1798).
- Ran two production dry runs at fixed time `2026-07-30T00:00:00Z` against
  snapshot
  `e4253d203408efe65f4ad4199ccaebf3c83df68a182ce816865f6abc43837ff9`.
  Both selected the same 13 people and changed the same 14 paths, but produced
  different proposal checksums, proving the model seed alone was not
  deterministic.
- Added request-addressed immutable generation artifacts under the guild's
  private SeaweedFS prefix. Artifact creation is conditional, generated and
  stored responses are schema-validated, and every reuse verifies identity and
  response checksum. OpenAI seed zero remains an additional best-effort
  control.
- Passed seven focused cache/generation tests, all 751 Temporal tests,
  typecheck, lint, and all 30 affected repository gates. Merged the repair
  through PR
  [#1804](https://github.com/shepherdjerred/monorepo/pull/1804).
- Followed main Buildkite #6914 through its exact `temporal-worker` image build
  and smoke. It published digest
  `sha256:576a087a11e1b2e1e2de03310b6c46d2263af5c31da12bf130a8cd5df4367ca0`.
- Detected that the shared pending-image PR was force-updated by a later main
  build and dropped the Temporal pin before merge. Published the verified
  digest in dedicated GitOps PR
  [#1806](https://github.com/shepherdjerred/monorepo/pull/1806), passed all
  current-head gates, and merged it.
- Passed authoritative main Buildkite #6925 including Argo reconciliation.
  ArgoCD refreshed the Temporal chart to `2.0.0-6925`; deployment generation
  224 is fully observed and Ready. Pod
  `temporal-temporal-worker-585c8f7675-8h66b` runs with zero restarts at the
  exact #6914 image digest.
- Started the first cache-backed fixed-time production dry run as workflow
  `glitter-context-refresh-manual-3946b9a2-1cae-4796-9c54-5ed4a48219d7`.
  It created nine schema-valid immutable style artifacts totaling 115,302
  bytes, then failed closed on OpenAI's explicit billing/quota-exceeded 429.
  It created no branch, commit, pull request, or generated-context mutation.
- Confirmed `glitter-corpus-daily` remains unpaused with its next action at
  `2026-07-29T11:15:00Z`, while `glitter-context-refresh-weekly` remains paused
  with its next nominal action at `2026-08-03T18:00:00Z`.
- Added an exact manual snapshot pin consisting of the immutable snapshot UUID
  and SHA-256. Pinned refreshes derive and verify that immutable object directly
  and do not consult `snapshots/latest.json`, so the live daily schedule cannot
  change acceptance input between runs.
- Added focused coverage proving a pin ignores a newer latest pointer and fails
  closed on checksum or embedded-identity mismatch. Updated the operator and
  operations guide to require the same pin for both dry runs and the real run.

### Remaining

- Restore the merge-generated main build after its application-image smoke
  exposed Scout's expired season catalog. Add 2026 Season 3 Act 1 from Riot's
  published season start and patch schedule, then deploy the merged
  snapshot-pin worker image through GitOps.
- Restore quota for the OpenAI project used by the Temporal worker, or
  explicitly authorize a different production OpenAI credential for this
  workflow.
- Rerun the same fixed-time dry run with snapshot
  `dbb59f00-3f6b-4cab-a87c-6d8a65e21d62` at checksum
  `e4253d203408efe65f4ad4199ccaebf3c83df68a182ce816865f6abc43837ff9`.
  It will reuse the nine accepted artifacts and generate only the four missing
  style cards.
- Run the fixed-time dry run again with the same pin and require complete output
  equality, including the proposal checksum.
- Run the real fixed-time refresh with the same pin, inspect its sole PR or
  no-diff result, and smoke-test the shared package, Birmel, Scout, and Glitter
  consumers.
- Deliberately unpause `glitter-context-refresh-weekly`, verify schedule and
  storage-integrity observability, then complete and archive this plan and its
  related TODOs.

### Caveats

- The worker's OpenAI key is distinct from the Birmel and Pokémon production
  keys. Reusing either would cross a credential and billing boundary and
  requires explicit operator authorization.
- A 1Password metadata-only lookup was attempted to inspect the Temporal item,
  but local authorization timed out. No secret value was revealed, written, or
  changed.
- The nine persisted artifacts are the intended safe resume mechanism; retries
  against the same pinned snapshot will not pay for or regenerate those
  accepted responses.

## Session Log — 2026-07-29 (production deployment and quota confirmation)

### Done

- Fixed the Argo release suspension schema so every suspended application keeps
  a valid disabled automated-sync object, then passed all 31 suspension syncs
  in authoritative main Buildkite #7040.
- Replaced byte-level Helm chart fingerprints with canonical parsed-chart
  fingerprints. PR
  [#1820](https://github.com/shepherdjerred/monorepo/pull/1820) passed
  current-head Buildkite #7045 and merged; main Buildkite #7052 successfully
  published all ten expected charts and passed the complete Argo sync lane.
- Merged generated pin PR
  [#1821](https://github.com/shepherdjerred/monorepo/pull/1821) after
  current-head Buildkite #7055 passed. The repository now durably pins the
  Temporal worker from build 7052.
- Verified production Argo is Synced and Healthy at Temporal chart
  `2.0.0-7052`, and the Ready worker runs immutable image
  `2.0.0-7052@sha256:580e41600ab0c1cc33d9d4f91a68c1ac7cc2126de68b6ade291b092719d8e4b2`.
- Made Argo readiness revision-aware so a terminal failure from an older chart
  revision cannot leave an otherwise current Synced and Healthy application
  permanently Progressing. Current-revision, unversioned, and active
  operations still block. PR
  [#1822](https://github.com/shepherdjerred/monorepo/pull/1822) passed
  current-head Buildkite #7061 and merged.
- Ran the fixed-time, snapshot-pinned production dry run as workflow
  `glitter-context-refresh-manual-cba098d4-60dd-4aea-af22-e65207b459eb`, run
  `019fade0-3129-796d-b701-6d46b6b69f04`. Both configured activity attempts
  failed closed on OpenAI HTTP 429 `insufficient_quota`; the workflow produced
  no repository or generated-context mutation.
- Confirmed `glitter-corpus-daily` remains active after its successful scheduled
  action on July 29, with the next action at `2026-07-30T11:15:00Z`.
  `glitter-context-refresh-weekly` remains deliberately paused, with its next
  nominal action at `2026-08-03T18:00:00Z`.
- Queried production observability after the rollout: snapshot metric
  restoration is configured, the latest verified snapshot reports 212,415
  messages, and every worker series reports zero SeaweedFS storage-integrity
  failures over 24 hours.
- Prepared PR
  [#1824](https://github.com/shepherdjerred/monorepo/pull/1824) for the two
  non-Glitter main gates exposed after the successful #7052 Argo lane: a
  confirmed AWS CLI HeadObject 404 classifier for a missing Scout release
  index, and the missing `homelab` package in the Cloudflare lane's
  production-only install. Focused tests, pipeline validation, all 35 affected
  verification tasks, and a clean production-filtered install plus `zod`
  resolution check pass.

### Remaining

- Merge PR #1824 after its replacement current-head Buildkite and review gates
  pass, then require the authoritative merged-main build to pass.
- Restore quota for the OpenAI project used by the Temporal worker, or
  explicitly authorize a different production OpenAI credential for this
  workflow.
- Rerun the pinned fixed-time dry run twice and require byte-identical outputs,
  then run the real refresh, inspect its sole PR or no-diff result, and
  smoke-test the shared package, Birmel, Scout, and Glitter consumers.
- Deliberately unpause `glitter-context-refresh-weekly` only after those
  acceptance gates pass, then complete and archive this plan and its related
  TODOs.

### Caveats

- OpenAI rejected both attempts before the four missing style cards could be
  generated. The nine prior immutable artifacts remain valid and reusable.
- The Temporal OpenAI credential is distinct from the Birmel and Pokémon
  credentials. No credential was read, copied, substituted, or changed during
  this session.
- Main Buildkite #7052 is red overall even though its Glitter-critical image,
  Helm, and Argo lanes passed; the two remaining failures are the exact gates
  fixed by PR #1824.

## Session Log — 2026-07-29 (main release follow-up)

### Done

- Merged PR
  [#1824](https://github.com/shepherdjerred/monorepo/pull/1824) after
  current-head Buildkite #7067 passed every gate and the Codex documentation
  finding was addressed and resolved.
- Ran the production recovery verifier against the latest scheduled daily
  snapshot. Snapshot `07d2998a-c2d0-4f15-aaab-c365bb103066` is complete across
  all 267 channels with 212,415 unique messages and SHA-256
  `04b53f7bbf0a3186297d14e5522aa2edc0992fb7def721e4e6faa1f68ef5b776`.
- Followed authoritative main Buildkite #7070 through image and chart
  publication. Every image was content-identical, including the Temporal
  worker, and canonical Helm comparison published zero charts.
- Confirmed the Cloudflare lane's production-only dependency repair passed.
  The Scout lane advanced past its prior missing-index failure and certified
  the complete 117 MiB archive.
- Diagnosed Scout's next fail-fast error: the immutable `aws s3api put-object`
  call attempted to launch the absent `less` pager. Added the AWS CLI's
  explicit `--no-cli-pager` global option to that exact command.
- Passed the seven focused Scout storage tests, an AWS CLI skeleton invocation
  with an intentionally nonexistent pager, and all four affected repository
  verification tasks.

### Remaining

- Publish and merge the pager fix after current-head Buildkite and review pass,
  then require the replacement authoritative main build to pass every gate.
- Restore the Temporal worker OpenAI project's quota, then complete the two
  deterministic dry runs, real refresh, consumer smoke tests, and deliberate
  weekly schedule unpause.
- Complete and archive this plan and its related TODOs only after weekly
  acceptance succeeds.

### Caveats

- Main Buildkite #7070 proves both fixes from PR #1824 but remains red because
  the newly reached immutable put attempted to invoke a pager unavailable in
  the production container.
- The pager fix does not weaken immutable-write semantics: the
  `If-None-Match: *` precondition and explicit 412 classification are
  unchanged.
- The Glitter production worker and corpus were not mutated by this Scout
  release follow-up.

## Session Log — 2026-07-29 (npm publish retry hardening)

### Done

- Updated the npm publisher to run through the repository's transient-failure
  classifier, so a failed npm token-introspection preflight can return
  Buildkite's retryable exit code instead of terminating the main release
  chain immediately.
- Extended transient classification for Bun transport cause codes and explicit
  HTTP/status 5xx syntax without treating source line numbers in an error stack
  as response statuses.
- Preserved the known Helm `504 Gateway Time-out` response as retryable and
  added regressions for both that spelling and a logical error at source line 515.
- Passed all 31 focused classifier tests, root-script typecheck and lint, and
  the complete affected verification surface for PR
  [#1828](https://github.com/shepherdjerred/monorepo/pull/1828).

### Remaining

- Merge PR #1828 after its replacement current-head Buildkite and review gates
  pass, then require the authoritative merged-main release and Scout production
  reconciliation lanes to pass.
- Restore the Temporal worker OpenAI project's quota, then complete the two
  deterministic dry runs, real refresh, consumer smoke tests, and deliberate
  weekly schedule unpause.

### Caveats

- The retry classifier remains fail-fast for logical failures and 4xx
  responses; only explicit 5xx, known network/TLS signatures, and known
  overlapping Argo operations receive Buildkite's transient exit code.
- This CI hardening did not mutate the production Glitter corpus, schedules, or
  worker credentials.

## Session Log — 2026-07-29 (final production status)

### Done

- Completed the trusted-seed import, production backfill, manual daily capture,
  and scheduled daily capture. The latest scheduled run,
  `glitter-corpus-daily-workflow-2026-07-29T11:15:00Z` /
  `019fad95-bf8f-7c9d-9ef3-368be4bdf27f`, published complete snapshot
  `07d2998a-c2d0-4f15-aaab-c365bb103066` with 267 channels, 212,415 unique
  messages, and SHA-256
  `04b53f7bbf0a3186297d14e5522aa2edc0992fb7def721e4e6faa1f68ef5b776`.
- Re-ran the recovery verifier from the production Temporal worker after the
  final release. It independently returned the same snapshot identity, channel
  count, message count, and checksum.
- Shipped the worker, release-coordination, Argo, Scout reconciliation, and
  release-retry repairs through PRs #1819, #1820, #1821, #1822, #1824, #1825,
  #1826, and #1828. Authoritative main Buildkite #7105 passed every release
  lane at commit `5a2b6135b066a1bc87e5556417972fbe78bb816f`, including npm
  publication, Helm, Argo, and Scout production reconciliation.
- Fixed the HIGH-severity CVE-2026-56852 found by the final status PR's Trivy
  gate by upgrading the AsusWRT provider's indirect `golang.org/x/text`
  dependency from 0.37.0 to 0.39.0 and its required `golang.org/x` dependency
  closure. The provider's tests, vet, golangci-lint, and a fresh Trivy scan all
  pass.
- Archived the completed Discord/SeaweedFS operator-acceptance TODO and removed
  its obsolete R2 requirements. Narrowed the remaining credential TODO to the
  OpenAI quota-gated weekly refresh acceptance only.
- Reconciled and archived the completed source-of-truth implementation plan so
  the active workboard no longer advertises obsolete pre-seed tasks.
- Closed the historical implementation handoff and pointed it to the archived
  source plan plus this active production rollout.
- Verified the production deployment is fully observed and Ready at immutable
  worker image
  `2.0.0-7052@sha256:580e41600ab0c1cc33d9d4f91a68c1ac7cc2126de68b6ade291b092719d8e4b2`.
  The Temporal Argo application is Synced and Healthy after the final release.
- Confirmed `glitter-corpus-daily` is active, with its next action at
  `2026-07-30T11:15:00Z`. Confirmed
  `glitter-context-refresh-weekly` remains deliberately paused, with its next
  nominal action at `2026-08-03T18:00:00Z`.
- Rechecked production observability after the final release:
  `glitter_corpus_snapshot_metrics_configured` is 1,
  `glitter_corpus_snapshot_messages` is 212,415, and every worker series reports
  zero SeaweedFS storage-integrity failures over 24 hours.
- Exercised the wired context-refresh workflow at fixed time
  `2026-07-30T00:00:00Z` against immutable snapshot
  `dbb59f00-3f6b-4cab-a87c-6d8a65e21d62` and checksum
  `e4253d203408efe65f4ad4199ccaebf3c83df68a182ce816865f6abc43837ff9`.
  Both configured activity attempts failed closed on OpenAI HTTP 429
  `insufficient_quota`; no branch, pull request, or generated-context mutation
  occurred.
- Reconciled the active plan's top-level summary and implementation checklist
  with production so operators see the seed, SeaweedFS deployment, backfill,
  recovery, and daily activation as complete, with only weekly acceptance
  remaining.

### Remaining

- Restore quota for the OpenAI project used by the Temporal worker, or
  explicitly authorize a different production OpenAI credential for this
  workflow.
- Rerun the same snapshot-pinned fixed-time dry run twice and require complete
  output equality, including the proposal checksum.
- Run the real fixed-time refresh with the same pin, inspect its sole PR or
  no-diff result, and smoke-test the shared package, Birmel, Scout, and Glitter
  consumers.
- Deliberately unpause `glitter-context-refresh-weekly` only after those
  acceptance gates pass, then complete and archive this plan and its related
  TODOs.

### Caveats

- The corpus-capture half of the feature is seeded, verified, and operating
  daily in production. The context-refresh half is wired and fails closed, but
  it is not accepted or scheduled while its OpenAI project has no quota.
- Nine schema-valid immutable generation artifacts remain reusable. Four style
  cards are still missing and cannot be generated until the quota boundary is
  resolved.
- The Temporal OpenAI credential is distinct from the Birmel and Pokémon
  credentials. No credential was read, copied, substituted, or changed during
  this session.

## Session Log — 2026-07-29 (quota recheck)

### Done

- Re-audited production from the live cluster. ArgoCD reports the `temporal`
  application Synced and Healthy at chart `2.0.0-7052`; the Ready worker still
  runs immutable image
  `2.0.0-7052@sha256:580e41600ab0c1cc33d9d4f91a68c1ac7cc2126de68b6ade291b092719d8e4b2`.
- Verified the worker still projects the Starlight Discord token, all required
  SeaweedFS settings, and the Temporal-specific `OPENAI_API_KEY`.
- Confirmed `glitter-corpus-daily` remains active after its successful July 29
  action, with its next action at `2026-07-30T11:15:00Z`. Confirmed
  `glitter-context-refresh-weekly` remains paused at the intended acceptance
  note, with its next nominal action at `2026-08-03T18:00:00Z`.
- Re-ran the exact fixed-time, snapshot-pinned dry run as workflow
  `glitter-context-refresh-manual-a3f6ec23-cb6d-45db-9766-f75009766b00`, run
  `019fae74-d06a-7533-8306-98360cf94c7d`. Both configured attempts again
  failed closed on OpenAI HTTP 429 `insufficient_quota`; OpenAI request IDs
  were `req_347605d0e5934938b6e96144a76e99a6` and
  `req_e0157cc73438445da69c6925528f20cc`.
- Verified the failed dry run created no branch, pull request, or
  generated-context mutation. The weekly schedule was not unpaused.

### Remaining

- Restore quota for the OpenAI project used by the Temporal worker, or
  explicitly authorize a different production OpenAI credential for this
  workflow.
- Rerun the same snapshot-pinned fixed-time dry run twice and require complete
  output equality, including the proposal checksum.
- Run the real fixed-time refresh with the same pin, inspect its sole PR or
  no-diff result, and smoke-test the shared package, Birmel, Scout, and Glitter
  consumers.
- Deliberately unpause `glitter-context-refresh-weekly` only after those
  acceptance gates pass, then complete and archive this plan and its related
  TODOs.

### Caveats

- The production credential is present and reaches OpenAI; the current blocker
  is quota on its owning OpenAI project, not missing Kubernetes or 1Password
  wiring.
- Nine schema-valid immutable generation artifacts remain reusable. Four style
  cards remain ungenerated until quota is restored.
- The Temporal OpenAI credential is distinct from the Birmel and Pokémon
  credentials. No credential was read, copied, substituted, or changed during
  this recheck.

## Session Log — 2026-07-29 (credential boundary diagnosis)

### Done

- Probed OpenAI directly from the deployed worker without reading or printing
  its credential. `GET /v1/models/gpt-5.6-sol` returned HTTP 200, proving the
  key authenticates and can access the configured model.
- Sent a minimal 16-token completion request with the configured
  `gpt-5.6-sol` model. OpenAI returned HTTP 429 with error type and code
  `insufficient_quota`; the request ID was
  `req_3b7c0ed562be4905ae4c68e65f2e71ba`.
- Identified the exact credential source from the deployed Kubernetes Secret
  metadata: 1Password item `mjgnqqh37jxyzseqrddde2jgaq`, item version `19`,
  field `OPENAI_API_KEY`. No secret value was retrieved.
- Attempted one metadata-only 1Password lookup for a project or organization
  label. Local authorization timed out, and OpenAI returned no project or
  organization response header, so no billing-project identifier could be
  established without operator access.

### Remaining

- In the OpenAI dashboard, identify the project that owns the key stored in
  1Password item `mjgnqqh37jxyzseqrddde2jgaq` and restore its usable quota or
  billing balance. If OpenAI support is needed, provide request ID
  `req_3b7c0ed562be4905ae4c68e65f2e71ba`.
- Rerun the same snapshot-pinned fixed-time dry run twice and require complete
  output equality, including the proposal checksum.
- Run the real fixed-time refresh with the same pin, inspect its sole PR or
  no-diff result, and smoke-test the shared package, Birmel, Scout, and Glitter
  consumers.
- Deliberately unpause `glitter-context-refresh-weekly` only after those
  acceptance gates pass, then complete and archive this plan and its related
  TODOs.

### Caveats

- The direct model-read/completion split rules out an invalid key, unavailable
  model, missing environment variable, Kubernetes projection failure, and
  generic network failure. The remaining boundary is the key's OpenAI project
  quota or billing state.
- The deployed secret metadata does not contain the OpenAI project ID, and the
  API response did not disclose it. Resolving that final identifier requires
  access to the OpenAI dashboard or successful 1Password operator
  authentication.
- No credential value was read, printed, copied, substituted, or changed.

## Session Log — 2026-07-29 (quota restoration and cached acceptance)

### Done

- Verified the cache-enabled production worker and recovery-verified pinned
  corpus snapshot.
- Completed the first dry run by reusing nine immutable generation artifacts
  and generating only the four missing style cards.
- Completed a second byte-identical dry run and the real refresh with zero
  additional OpenAI calls; all three returned proposal SHA-256
  `9f558af01bf18f2082499c61cd400b44b27bb1e0f93e878978c1cf785e582538`.
- Opened generated-context PR #1834 and passed focused build, typecheck, test,
  and lint for Glitter context, Birmel, Scout data, and the Glitter app.

### Remaining

- Complete human review and current-head Buildkite #7145 for PR #1834.
- Merge PR #1834, run merged-main and production consumer smoke checks, then
  deliberately unpause `glitter-context-refresh-weekly`.
- Complete and archive this plan and its related TODOs.

### Caveats

- The weekly schedule remains deliberately paused.
- PR #1834 requires subjective human review and is never auto-merged.
- The generated-context proposal is cached; review, CI, and real-run retries do
  not require another OpenAI generation.
- Current-head Buildkite #7145 is scheduled but cannot start while the
  dedicated CI node `liskov` is offline; Kubernetes last received its heartbeat
  at 11:04 PDT and deliberately does not fall back to the production node.

## Session Log — 2026-07-29 (production corpus inclusion audit)

### Done

- Reran the full production recovery verifier against snapshot
  `07d2998a-c2d0-4f15-aaab-c365bb103066` at SHA-256
  `04b53f7bbf0a3186297d14e5522aa2edc0992fb7def721e4e6faa1f68ef5b776`.
  It reconstructed all 267 complete channel states and returned 212,415 unique
  message IDs.
- Independently loaded the trusted seed projection and the final projection.
  All 76,762 unique seed message IDs are present in the final snapshot; neither
  projection contains duplicate message IDs.
- Audited Aaron's generated coverage count. The final projection contains
  10,036 unique messages by Aaron: all 5,539 seed IDs plus 4,497 messages beyond
  the seed, across 102 channels. All 10,036 selected current observations came
  from the Discord REST capture.

### Remaining

- Decide whether the 13 channels excluded for missing message-history
  permission should be added to the approved corpus scope. If so, grant access,
  regenerate inventory, and complete their backfill before making a
  whole-guild completeness claim.
- Complete human review and current-head CI for generated-context PR #1834.

### Caveats

- “All messages” is proven for the 267 approved channels the bot could read at
  the snapshot boundary, not for the 13 inaccessible channels. The other 17
  excluded inventory entries are non-message channel types.
- Aaron's prior `coverage.messages: 5011` described an explicitly truncated
  sample with a narrower date range; it was not a prior full-corpus count and
  should not be interpreted as having doubled.
