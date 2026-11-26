---
title: Enforce SeaweedFS lifecycle expiry
description: Read the SeaweedFS lifecycle sweep's dry-run report, then enable deletes for one bucket or all of them, and stop them again.
---

Review what the sweep would delete before letting it delete.

SeaweedFS stores S3 lifecycle `Expiration` rules but never applies them.
The `seaweedfs-lifecycle-enforcer` Temporal schedule applies them instead,
reading each bucket's live lifecycle configuration every day at 04:30 in
`America/Los_Angeles`.
It starts paused, and its mode defaults to `report`, so nothing is deleted until you do step 4.

Run these commands with the existing authenticated `toolkit temporal` and `toolkit flags` connections.

## 1. Confirm the schedule is paused and the flags are at their defaults

```bash
toolkit temporal --namespace prod --output json schedule describe \
  --schedule-id seaweedfs-lifecycle-enforcer
for flag in mode max-deletes buckets; do
  toolkit flags get temporal/prod "seaweedfs-lifecycle-enforcer-$flag" --json
done
```

Expect the schedule paused, `mode` = `report`, `max-deletes` = `20000`, and `buckets` = `*`.
The flags use targeting key `seaweedfs-lifecycle-enforcer-prod` with `environment=prod`.
An unavailable Flags service always resolves to `report`.

## 2. Run a dry-run report

A manual run with `dryRun` reports whatever the mode flag says, and never deletes:

```bash
lifecycle_id="seaweedfs-lifecycle-review-$(date -u +%Y%m%dT%H%M%SZ)"
toolkit temporal --namespace prod workflow start \
  --workflow-id "$lifecycle_id" \
  --type runSeaweedfsLifecycleEnforcer --task-queue monorepo-workflows \
  --input '{"dryRun":true}'
```

Copy the Run ID printed by `start`, then read the completed result:

```bash
lifecycle_run_id='<run-id-from-start>'
toolkit temporal --namespace prod --output json workflow result \
  --workflow-id "$lifecycle_id" --run-id "$lifecycle_run_id" \
  > lifecycle-report.json
jq -r '.result.buckets[] | .bucket as $b | .rules[]
  | [$b, .ruleId, .prefix, .days, .candidates, .candidateBytes,
     .oldestCandidateAgeDays, .status] | @tsv' lifecycle-report.json
```

Each rule reports the rule ID, prefix, and days it enforces, then:

| Field                                              | Meaning                                                                          |
| -------------------------------------------------- | -------------------------------------------------------------------------------- |
| `candidates`, `candidateBytes`                     | Objects under the prefix last modified more than `days` days ago, and their size |
| `oldestCandidateAgeDays`, `newestCandidateAgeDays` | Age range of the candidates                                                      |
| `sampleKeys`                                       | The first ten candidate keys, to eyeball                                         |
| `status`                                           | `complete`, `cap-reached` (counts are a lower bound), `aborted`, or `failed`     |
| `deleted`, `deleteErrors`, `errorSamples`          | Delete outcomes; all zero in a report                                            |

Check these before proceeding:

- Every candidate prefix is genuinely disposable. The sweep deletes whatever a rule covers, including a rule with an empty prefix, which covers the whole bucket.
- `unsupported` lists rules the sweep skips (tag filters, `Date`, versions, transitions); it never applies them.
- `withoutLifecycle` lists buckets with no configuration; the sweep never touches them.
- `failedBuckets` is `0`.

The sweep enforces the live lifecycle configuration, which the `seaweedfs` OpenTofu stack writes.
When a rule in the report differs from the source, apply the stack first with
[Change an OpenTofu stack](/how-to/change-an-opentofu-stack/).

The same numbers are exported as `seaweedfs_lifecycle_candidates_total{bucket,rule}`,
`seaweedfs_lifecycle_candidate_bytes{bucket,rule}`, `seaweedfs_lifecycle_deleted_total{bucket,rule}`,
`seaweedfs_lifecycle_last_run_timestamp_seconds{mode}`, and `seaweedfs_lifecycle_bucket_failed{bucket}`.

## 3. Stage the first deletes

Limit the first real run to one reviewed bucket and a small cap.
Write both flags with a reviewed batch bound to the deployment's current revision
(see [Operate feature flags and check the inventory](/how-to/check-flag-inventory/)):

```bash
toolkit flags get temporal/prod seaweedfs-lifecycle-enforcer-mode --json   # note .revision
cat > lifecycle-stage.json <<'JSON'
{
  "deployment": "temporal/prod",
  "expectedRevision": 0,
  "flags": [
    { "key": "seaweedfs-lifecycle-enforcer-buckets", "type": "variant", "value": "ci-handoff" },
    { "key": "seaweedfs-lifecycle-enforcer-max-deletes", "type": "variant", "value": "1000" }
  ]
}
JSON
# Replace 0 with the revision, then:
toolkit flags apply --file lifecycle-stage.json
```

`buckets` is a comma-separated allowlist (`ci-handoff,cook`) or `*` for every bucket.
`max-deletes` caps objects deleted per run across all buckets; the run stops at the cap and reports `cap-reached`.
Buckets outside the allowlist are still reported.

## 4. Enable deletes

Set `seaweedfs-lifecycle-enforcer-mode` to `delete` the same way, then run once by hand:

```bash
lifecycle_id="seaweedfs-lifecycle-first-$(date -u +%Y%m%dT%H%M%SZ)"
toolkit temporal --namespace prod workflow start \
  --workflow-id "$lifecycle_id" \
  --type runSeaweedfsLifecycleEnforcer --task-queue monorepo-workflows \
  --input '{"dryRun":false}'
```

Read its result as in step 2.
`deleted` and `deletedBytes` must match what you reviewed, and `deleteErrors` must be `0`.
Confirm one past-due object is gone, for example with `aws s3api head-object` against its sample key.

When the staged run is right, widen `buckets` (to `*`) and `max-deletes`, then resume the schedule:

```bash
toolkit temporal --namespace prod schedule toggle \
  --schedule-id seaweedfs-lifecycle-enforcer --unpause \
  --reason 'SeaweedFS lifecycle deletes reviewed and enabled'
```

Unpausing without the `delete` mode flag runs reports only.

## 5. Stop deletes

Set `seaweedfs-lifecycle-enforcer-mode` back to `report`.
Each delete request re-reads the flags, so a running sweep stops deleting within one page
and finishes as a report.
To stop future runs too, pause the schedule:

```bash
toolkit temporal --namespace prod schedule toggle \
  --schedule-id seaweedfs-lifecycle-enforcer --pause \
  --reason 'Stopping SeaweedFS lifecycle deletes'
```

Deleted objects are not restored.
Retry a failed bucket by starting a run again; sweeps re-list from the start, so a retry never trusts an earlier page.

The source contracts are
`packages/temporal/src/schedules/seaweedfs-lifecycle-schedule.ts`,
`packages/temporal/src/config/seaweedfs-lifecycle-enforcer.ts`, and
`packages/temporal/src/activities/maintenance/seaweedfs-lifecycle/core.ts`.

## Related

- [Operate feature flags and check the inventory](/how-to/check-flag-inventory/)
- [Pause or debug a schedule](/how-to/pause-or-debug-a-schedule/)
- [Roll out a Temporal Worker Deployment](/how-to/roll-out-a-temporal-worker-deployment/)
