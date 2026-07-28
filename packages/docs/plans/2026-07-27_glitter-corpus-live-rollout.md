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
gaps, wire credentials, mirror the trusted seed, publish a verified complete
snapshot, exercise daily and weekly workflows, and unpause both schedules.

The archive's `glitter-boys` and `league-of-legends` roots are channel-export
groups from the same Discord guild: embedded threads in both report guild ID
`208425771172102144`. The importer currently misclassifies those roots as
separate guilds and must be fixed before seeding.

Publish a two-PR git-spice stack:

1. `fix(temporal): harden Glitter corpus rollout`
2. `feat(homelab): wire Glitter corpus credentials`

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

- The operator creates a dedicated `Glitter Corpus Archiver` application with
  Message Content Intent and only View Channel plus Read Message History in the
  approved public scope.
- The operator creates an R2 Object Read & Write token restricted to
  `glitter-discord-corpus` and populates the six Discord/R2 fields in
  `temporal-temporal-worker-1p`.
- Refresh the hashed vault snapshot and project all twelve required runtime
  variables into the worker, reusing existing SeaweedFS credentials and using
  explicit non-secret bucket, region, and initial empty-denylist values.
- Merge both PRs bottom-up, require current-head and merged-main Buildkite
  success, follow image/GitOps deployment, and confirm both schedules remain at
  their operator-approval pause notes.

## Live Rollout

1. Import the archive twice with the explicit guild identity and require
   byte-identical outputs: 164 CSVs, 98 channels, 76,762 unique messages, and
   zero duplicate IDs.
2. Mirror the seed archive, manifest, projection, and channel partitions to
   SeaweedFS and R2 and verify every immutable object and receipt.
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
- Completion requires the corrected 76,762-message seed mirrored in both
  stores, a published recovery-verified snapshot containing every seed message,
  a verified daily cycle, accepted weekly execution, and both schedules
  deliberately unpaused.

## Remaining

- [ ] Implement and merge the Temporal hardening PR.
- [ ] Complete the privileged credential handoff and merge deployment wiring.
- [ ] Mirror and verify the trusted seed.
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
- Confirmed the existing SeaweedFS credential fields are populated and the six
  new Discord/R2 credential fields are not yet present in the worker's
  1Password item.

### Remaining

- Publish and merge the two-PR stack after the six credential fields are
  populated, then execute the live rollout checklist above.

### Caveats

- Credential provisioning and inventory/full-scrape approval are explicit
  operator gates; no secret values belong in this document or chat.
