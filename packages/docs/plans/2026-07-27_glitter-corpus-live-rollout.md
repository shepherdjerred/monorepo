---
id: plan-2026-07-27-glitter-corpus-live-rollout
type: plan
status: in-progress
board: true
verification: operator
disposition: blocked
---

# Complete the Glitter Discord Corpus Rollout

## Summary

Finish the feature through production operation: close remaining correctness
gaps, wire credentials, upload the trusted seed, publish a verified complete
snapshot, exercise daily and weekly workflows, and unpause both schedules.

The archive's `glitter-boys` and `league-of-legends` roots are channel-export
groups from the same Discord guild: embedded threads in both report guild ID
`208425771172102144`. The importer currently misclassifies those roots as
separate guilds and must be fixed before seeding.

The hardening and live-discovered Discord member lookup fixes shipped in pull
requests 1750 and 1752. Publish the remaining SeaweedFS storage/deployment
change as a single git-spice PR.

Keep both production schedules paused until their individual acceptance gates
pass.

## Implementation

### PR 1 — corpus and workflow hardening

- Normalize the entire trusted ZIP to guild `208425771172102144` and slug
  `glitter-boys`; require explicit production import flags, validate embedded
  thread guild IDs, version the manifest, and repin the corrected deterministic
  projection hash while retaining the archive hash and 76,762-message pin.
- Preserve the prior verified projection when the six-overlap lineage resets to
  a complete traversal. Record the retained baseline in the complete manifest
  and make recovery reproduce the same bounded projection.
- Fail daily inventory before publication when a previously captured,
  non-denylisted public-thread parent is missing or no longer grants View
  Channel plus Read Message History.
- Replace the request timestamp lease with a CAS-protected 60-second in-flight
  lease. Release it in `finally` and set the next request to the later of
  completion plus one second or Discord's reset deadline.
- Derive weekly refresh branch identity from the Temporal workflow run ID,
  reuse an existing exact-head PR, return a deterministic proposal checksum,
  and add a supported context-refresh operator command.
- Correct the canary runbook: backward traversal ends empty; forward traversal
  ends non-empty at the frozen upper bound; both ID sets must match.

### PR 2 — credential and deployment wiring

- Reuse the existing production `Starlight` bot identity. Project its
  `DISCORD_TOKEN` from the Starlight 1Password item into the Temporal namespace;
  keep guild ID `208425771172102144` and slug `glitter-boys` as non-secret
  literals.
- Use SeaweedFS as the sole canonical object store. Project the existing worker
  S3 credentials and explicit non-secret bucket, region, and initial
  empty-denylist values; do not provision or project Cloudflare R2 credentials.
- Replace the pre-production dual-mirror schema with a single checksum-verified
  SeaweedFS receipt and retain immutable collision detection, read-after-write
  verification, recovery checks, and monotonic pointer publication.
- Merge both PRs bottom-up, require current-head and merged-main Buildkite
  success, follow image/GitOps deployment, and confirm both schedules remain at
  their operator-approval pause notes.

## Live Rollout

1. Import the archive twice with the explicit guild identity and require
   byte-identical outputs: 164 CSVs, 98 channels, 76,762 unique messages, and
   zero duplicate IDs.
2. Upload the seed archive, manifest, projection, and channel partitions to
   SeaweedFS and verify every immutable object and receipt.
3. Run inventory and obtain explicit approval of every included/excluded entry
   and its immutable SHA. All 98 seed channel IDs must be approved.
4. Run a seed-backed canary on an approved channel with more than 100 messages.
5. After explicit full-scrape approval, run and monitor the complete backfill.
6. Run recovery verification and prove every seed message is present in the
   canonical snapshot.
7. Run one manual daily cycle while paused, verify recovery again, then unpause
   `glitter-corpus-daily`.
8. Run the weekly context refresh twice as fixed-time dry runs and require
   identical snapshot/proposal checksums and outputs.
9. Run one real weekly refresh, review its sole PR or no-diff result, smoke-test
   Birmel, Scout, and Glitter, then unpause
   `glitter-context-refresh-weekly`.
10. Confirm schedule next-run times and clean corpus/context observability.

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
- [ ] Approve inventory and complete canary, backfill, and recovery.
- [ ] Accept daily and weekly workflows and unpause both schedules.
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

### Remaining

- Publish and deploy the live-canary fixes, rerun the canary with a deliberate
  1,000-page ceiling, then complete backfill, recovery, and schedule
  acceptance.
- Merge the image-bake entitlement correction and verify its authoritative
  current-main image publication and Temporal worker rollout.
- Reconcile the daily schedule from its false missing-denylist pause to its
  explicit operator-approval hold; keep both schedules paused until their
  respective acceptance gates pass.

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
