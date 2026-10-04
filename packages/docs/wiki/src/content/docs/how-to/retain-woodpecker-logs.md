---
title: Retain Woodpecker logs safely
description: Review an exact expiration manifest, apply log-only deletion, and enable bounded daily retention without removing pipeline metadata.
---

Review a dry-run manifest before enabling Woodpecker log deletion or resuming its daily schedule.

Run these commands with the existing authenticated `toolkit temporal` connection.
Keep manifests and receipts in private operator evidence; they contain repository and commit identifiers, but no log content.

## 1. Deploy capable workers and keep the schedule paused

Deploy the retention Workflow bundle and its infra Activities through the normal release path.
Follow [Roll out a Temporal Worker Deployment](/how-to/roll-out-a-temporal-worker-deployment/)
until the capable central candidate receives 100% of Workflow traffic, or has been promoted to current.
Starting this new Workflow type during a partial ramp can route it to an older worker that does not register it.

Inspect the schedule after reconciliation:

```bash
toolkit temporal --namespace prod --output json schedule describe \
  --schedule-id woodpecker-log-retention-daily
```

Confirm it is paused, runs at 04:45 in `America/Los_Angeles`, and uses `SKIP` overlap handling.
The definition initially pauses it pending manifest review and deletion approval.
If it is already active, pause it before this procedure:

```bash
toolkit temporal --namespace prod schedule toggle \
  --schedule-id woodpecker-log-retention-daily --pause \
  --reason 'Reviewing Woodpecker log retention manifest'
```

Check the managed flags in Flipt's `temporal` namespace using
[Check the Flipt flag inventory](/how-to/check-flipt-flag-inventory/).
Keep `woodpecker-log-retention-enabled` false during review.
Keep `woodpecker-log-retention-days` at its default 30 days, or an approved longer period; the typed minimum is 30.
These flags use targeting key `woodpecker-log-retention-prod` with `environment=prod`.
Unavailable flag evaluation disables deletion.

The source contracts are `packages/temporal/src/schedules/woodpecker-retention-schedule.ts`
and `packages/temporal/src/config/woodpecker-retention.ts`.

## 2. Run and capture an exact dry run

Choose a unique Workflow ID and start one bounded run:

```bash
retention_dry_id="woodpecker-retention-review-$(date -u +%Y%m%dT%H%M%SZ)"
toolkit temporal --namespace prod workflow start \
  --workflow-id "$retention_dry_id" \
  --type runWoodpeckerLogRetention --task-queue monorepo-workflows \
  --input '{"dryRun":true,"resumeScheduled":false}'
```

Copy the Run ID printed by `start` into `retention_dry_run_id`, then capture the completed result:

```bash
retention_dry_run_id='<run-id-from-start>'
toolkit temporal --namespace prod --output json workflow result \
  --workflow-id "$retention_dry_id" --run-id "$retention_dry_run_id" \
  > retention-dry-result.json
jq -e '.status == "COMPLETED" and .result.dryRun == true' retention-dry-result.json
jq '.result | {manifest, receipts, scanned, continuation, protectAllMain, protectionReasons}' \
  retention-dry-result.json
```

Review every candidate's repository identity, pipeline number, commit, terminal status, creation and finish times, and log-entry count.
Check the manifest's epoch-second cutoff against the intended retention period.
Both creation and completion must precede that cutoff.

Confirm current open PR heads, the latest successful default-branch commit, and proven deployed artifact pipelines remain protected.
Deployment evidence includes running Pods, Deployment templates, and actual ArgoCD chart revisions.
Inspect `protectAllMain` and `protectionReasons` before proceeding.
Unknown provenance keeps `main` and default-branch pipelines protected.
Digest-only `ci-base` images, ad hoc tags, and placeholder chart versions require producer fixes or proven ownership; do not weaken protection to increase deletion counts.

If there are no pipelines older than 30 days, an empty manifest is expected and yields no immediate space recovery.
Do not shorten the minimum or substitute `VACUUM FULL`, database restoration, archive deletion, or snapshot deletion for this procedure.

Each discovery Activity scans at most 100 pipelines; a run scans at most 1,000.
A non-null `continuation` means inventory is incomplete.
The daily schedule resumes its last completed scheduled cursor and cutoff when the repository inventory still matches.
An independent manual dry run starts a fresh scan; do not treat its partial manifest as complete inventory.

Review behavior against `packages/temporal/src/shared/woodpecker-retention.ts`
and `packages/temporal/src/activities/maintenance/woodpecker-retention-references.ts`.

## 3. Apply the reviewed manifest

Keep the schedule paused. Confirm existing authorization covers the retention policy and exact manifest application, then enable
`woodpecker-log-retention-enabled` for the production targeting key.
Preserve the reviewed result unchanged and create input directly from its manifest:

```bash
jq -e '.result.manifest | .cutoff > 0 and (.candidates | length) > 0' \
  retention-dry-result.json
jq '{dryRun:false,resumeScheduled:false,reviewedPlan:.result.manifest}' \
  retention-dry-result.json > retention-apply-input.json
retention_apply_id="woodpecker-retention-apply-$(date -u +%Y%m%dT%H%M%SZ)"
toolkit temporal --namespace prod workflow start \
  --workflow-id "$retention_apply_id" \
  --type runWoodpeckerLogRetention --task-queue monorepo-workflows \
  --input-file retention-apply-input.json
```

Skip manual apply for an empty manifest and continue to step 4 after accepting the production dry run.
Do not regenerate candidates between review and apply.
The `reviewedPlan` input restricts this run to the reviewed identities and cutoff.

Before each write, the Activity rechecks policy, pipeline identity, terminal status, PR heads, and deployment references.
It calls only `DELETE /api/repos/{repo}/logs/{number}`; pipeline metadata remains.
It verifies that every step's logs are empty after deletion; an HTTP success response alone is insufficient.
Retries use heartbeat receipts tied to the exact candidate prefix, and already empty logs are handled without another deletion.

Copy this run's Run ID into `retention_apply_run_id`, then inspect its result:

```bash
retention_apply_run_id='<run-id-from-start>'
toolkit temporal --namespace prod --output json workflow result \
  --workflow-id "$retention_apply_id" --run-id "$retention_apply_run_id" \
  > retention-apply-result.json
jq -e '.status == "COMPLETED" and .result.dryRun == false' retention-apply-result.json
jq '.result.receipts | group_by(.outcome) | map({outcome:.[0].outcome,count:length})' \
  retention-apply-result.json
```

Compare every receipt with the reviewed manifest.
Investigate `protected`, `changed`, or `disabled` outcomes before claiming deletion occurred.
Keep the run IDs, manifest, and receipts as acceptance evidence.
Verify pipeline metadata remains accessible and database/PVC usage over subsequent runs; filesystem space need not fall immediately.

The apply contract is implemented in `packages/temporal/src/activities/maintenance/woodpecker-retention-core.ts`
and `packages/temporal/src/activities/maintenance/woodpecker-retention-client.ts`.

## 4. Enable recurring retention or stop it

Resume the schedule after accepting the reviewed apply, or an empty production dry run, and confirming existing authorization covers ongoing policy-based deletion.
Scheduled runs discover new manifests; they do not reuse the manual approval manifest.
An accepted empty initial plan may enable the already authorized 30-day policy; no immediate deletion or space recovery is expected.
Confirm `woodpecker-log-retention-enabled` is true before resuming.

```bash
toolkit temporal --namespace prod schedule toggle \
  --schedule-id woodpecker-log-retention-daily --unpause \
  --reason 'Reviewed log retention accepted; recurring policy approved'
```

Confirm subsequent runs complete and inspect receipts and continuation checkpoints.
`SKIP` prevents overlap between scheduled runs; avoid starting manual apply runs alongside them.

To stop deletion, disable the flag and pause the schedule using step 1.
Pausing prevents future starts but does not cancel an active run.
Cancel the exact active execution when needed:

```bash
toolkit temporal --namespace prod workflow cancel \
  --workflow-id '<active-retention-workflow-id>' --run-id '<active-run-id>'
```

Cancellation stops further writes; it does not restore logs already deleted.
Inspect history and receipts before retrying the same reviewed plan.

## Related

- [Roll out a Temporal Worker Deployment](/how-to/roll-out-a-temporal-worker-deployment/)
- [Check the Flipt flag inventory](/how-to/check-flipt-flag-inventory/)
- [Pause or debug a schedule](/how-to/pause-or-debug-a-schedule/)
