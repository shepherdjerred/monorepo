# R2 Capacity Remediation Runbook

Procedure for when the `homelab` R2 bucket approaches or exceeds its 1.5 TB
limit (`R2StorageNearingLimit` / `R2StorageExceedingLimit`), or when the R2
orphan alerts fire (`VeleroR2OrphanPrefixes` /
`VeleroR2OrphanBytesExcessive`). Triage first: the inventory distinguishes
accumulated orphans (the usual cause — TTL-expired backups whose
`zfspv-incr` data was never deleted) from legitimate chain growth.

## When to use this runbook

Trigger any of these:

- PagerDuty fires `R2StorageNearingLimit` (80% of 1.5 TB) or
  `R2StorageExceedingLimit`
- PagerDuty fires `VeleroR2OrphanPrefixes` or `VeleroR2OrphanBytesExcessive`
- You notice the bucket growing faster than live PVC data justifies

## Prerequisites

```bash
kubectl version          # must reach the cluster
velero backup get        # must list current Backup CRs
aws --version            # local CLI present
```

The R2 commands use the repository's standard operator environment names. Run
the Bun commands below through `op run` with these references (same 1Password
item as the Velero cloud credentials); do not resolve them into a checked-in
env file:

```bash
export CLOUDFLARE_R2_ACCESS_KEY_ID='op://v64ocnykdqju4ui6j6pua56xw4/ypce2djferc6zf7bocxft36n6a/CLOUDFLARE_R2_ACCESS_KEY_ID'
export CLOUDFLARE_R2_SECRET_ACCESS_KEY='op://v64ocnykdqju4ui6j6pua56xw4/ypce2djferc6zf7bocxft36n6a/CLOUDFLARE_R2_SECRET_ACCESS_KEY'
export CLOUDFLARE_R2_ENDPOINT='op://v64ocnykdqju4ui6j6pua56xw4/ypce2djferc6zf7bocxft36n6a/CLOUDFLARE_R2_ENDPOINT'
```

## Step 1: Read-only triage

Confirm the alert level and the detection state. The Cloudflare usage API can
lag actual deletes by tens of minutes; the S3 listing is ground truth.

```bash
toolkit prom query 'cloudflare_r2_storage_bytes{bucket="homelab"}'
toolkit prom query 'velero_orphan_r2_prefixes_total{container="temporal-infra-worker"}'
toolkit prom query 'velero_orphan_r2_bytes_total{container="temporal-infra-worker"}'
toolkit prom query 'velero_orphan_local_snapshots_total{container="temporal-infra-worker"}'
```

Census live backups (expect ~25–35; anything else means Velero state itself
needs investigation first):

```bash
kubectl get backups.velero.io -n velero -o json | jq -r '.items | "total: \(length)"'
```

Inventory the bucket top level, then per-backup under the zfs data prefix:

```bash
cd packages/homelab/src/cdk8s
op run -- bun run r2:inventory
R2_PREFIX='zfspv-incr/backups/' R2_PREFIX_DEPTH='1' op run -- bun run r2:inventory
```

Quantify the guarded orphan set without deleting anything:

```bash
op run -- bun run r2:orphans -- inspect --manifest /tmp/r2-orphans.json
jq -r '"candidates=\(.candidates | length) gib=\(([.candidates[].bytes] | add) / 1024 / 1024 / 1024) protected=\(.protectedBackupNames | length)"' /tmp/r2-orphans.json
```

Rule out the other two hypotheses: abandoned multipart uploads, and a failed
backup that re-uploaded:

```bash
export AWS_ACCESS_KEY_ID="$CLOUDFLARE_R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$CLOUDFLARE_R2_SECRET_ACCESS_KEY"
op run -- sh -c 'aws s3api list-multipart-uploads --bucket homelab --endpoint-url "$CLOUDFLARE_R2_ENDPOINT" --region auto --output json' | jq '.Uploads | length'
velero backup get | grep -v Completed || true
```

## Step 2: Pick a branch

- **Orphans dominate** (candidates hold most of the excess bytes): follow
  `velero-orphan-snapshot-remediation.md` Steps 2–6 for the guarded manifest
  cleanup — R2 prefixes first, paired local snapshots only after. Never
  bypass the manifest tool with an ad-hoc `aws s3 rm`: fulls anchor the
  incrementals.
- **Legitimate growth** (most bytes sit under live backup names): tighten
  declared retention in
  `packages/homelab/src/cdk8s/src/resources/velero/velero-schedules.ts`
  (monitoring follows automatically), then review churn-heavy PVCs in
  `packages/homelab/src/cdk8s/src/backup-policy/pvc-backup-policy.json`.
  State the new recovery windows in the PR.
- **Multipart residue** (uploads > 0): the bucket lifecycle rule reaps parts
  older than 7 days automatically; for anything younger, wait or investigate
  the uploading backup — do not abort uploads belonging to a running backup.

## Step 3: Verify post-remediation state

```bash
cd packages/homelab/src/cdk8s
op run -- bun run r2:orphans -- inspect --manifest /tmp/r2-postcheck.json
op run -- bun run r2:inventory
```

The fresh inspection must show zero candidates and the inventory must total
below 1536 GiB. Then trigger both audits and confirm the gauges:

```bash
toolkit temporal schedule trigger --schedule-id velero-orphan-audit
toolkit temporal schedule trigger --schedule-id velero-r2-orphan-audit
# wait a few minutes, then:
toolkit prom query 'velero_orphan_local_snapshots_total{container="temporal-infra-worker"}'
toolkit prom query 'velero_orphan_r2_prefixes_total{container="temporal-infra-worker"}'
```

Both should report 0. The PagerDuty alerts auto-resolve once the metrics hold
for their `for:` windows.

## R2 audit credential bootstrap

The `velero-r2-orphan-audit` schedule stays paused until its read-only R2
credential exists (see `requiredEnvironment` in
`packages/temporal/src/schedules/schedule-definitions.ts`). To bootstrap it:

1. Mint an R2 S3 API token with **Object Read** only, scoped to the `homelab`
   bucket (Cloudflare dashboard — R2 tokens cannot be minted via OpenTofu).
2. Store it in a 1Password item with fields `VELERO_R2_S3_ENDPOINT`
   (`https://<account-id>.r2.cloudflarestorage.com`),
   `VELERO_R2_S3_BUCKET` (`homelab`), `VELERO_R2_S3_ACCESS_KEY_ID`, and
   `VELERO_R2_S3_SECRET_ACCESS_KEY`.
3. Add a `OnePasswordItem` for that item and wire the four fields into the
   infra worker env in
   `packages/homelab/src/cdk8s/src/resources/temporal/workers/operations-workers.ts`,
   following the existing `EnvValue.fromSecretValue` entries. Refresh the
   committed vault snapshot (`check:1password`).
4. The next schedule registration unpauses the schedule; trigger one manual
   run and confirm `velero_r2_orphan_audit_runs_total{outcome="success"}`
   increments.

## History

- 2026-09-24: bucket at 1.99 TB (131%). Triage found 206 orphan prefixes
  (1236 GiB, 62%) from chronic TTL-finalizer failure since 2026-06-01 —
  expired backups' CRs and metadata deleted correctly but their
  `zfspv-incr/backups/<name>/` data never did. Guarded manifest cleanup
  reclaimed it all; post-state 622 GiB, zero candidates.

## Cross-References

- Orphan cleanup runbook: `packages/temporal/runbooks/velero-orphan-snapshot-remediation.md`
- R2 workflow source: `packages/temporal/src/workflows/homelab/velero-r2-orphan-audit.ts`
- Alert rules: `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/storage/r2-storage.ts` (`velero-r2-orphans` group)
- Schedules/TTLs: `packages/homelab/src/cdk8s/src/resources/velero/velero-schedules.ts`
