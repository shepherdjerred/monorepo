# Velero Orphan-Snapshot Remediation Runbook

Procedure for manually pruning orphan ZFS snapshots and R2 objects detected by
the `velero-orphan-audit` Temporal workflow. The operation stays manual because
backup CR absence alone is not sufficient proof that remote backup data is safe
to delete.

## When to use this runbook

Trigger any of these:

- PagerDuty fires `VeleroOrphanLocalSnapshots` (orphan ZFS snapshots present > 24h)
- PagerDuty fires `VeleroOrphanLocalBytesExcessive` (orphan ZFS snapshot bytes over threshold)
- PagerDuty fires `ZFSDatasetSnapshotCountExcessive` (any PVC dataset > ~26 snapshots — backstop alert)
- You manually discover orphan R2 objects under `s3://homelab/zfspv-incr/` (the audit does **not** scan R2 — see Step 1)
- A PVC reads `100%` full unexpectedly and `zfs list` shows large `USED` vs small `REFER` (snapshot bloat — same root cause)
- Velero was just re-deployed (helm uninstall + reinstall, ArgoCD app re-creation, etc.)

## Prerequisites

```bash
kubectl version          # must reach the cluster
velero backup get        # must list current Backup CRs
aws --version            # local CLI present
```

The R2 commands use the repository's standard operator environment names. Load
them from 1Password without writing credentials to disk:

```bash
export CLOUDFLARE_R2_ACCESS_KEY_ID="op://..."
export CLOUDFLARE_R2_SECRET_ACCESS_KEY="op://..."
export CLOUDFLARE_R2_ENDPOINT="op://..."
```

Run the Bun commands below through `op run`; do not resolve these references
into a checked-in env file.

## Step 1: Verify the orphan finding

The audit workflow surfaces local ZFS-snapshot orphan counts via these Prometheus metrics:

- `velero_orphan_local_snapshots_total{dataset="..."}`
- `velero_orphan_local_bytes_total{dataset="..."}`

The audit only scans local ZFS snapshots — there is **no** R2 orphan metric or alert. Check for orphan R2 objects manually with the `aws s3 ls` steps below.

Confirm with `toolkit prom query` and cross-check independently before destroying anything.

```bash
toolkit prom query 'velero_orphan_local_snapshots_total'
```

Also confirm the workflow itself ran recently:

```bash
kubectl exec -n temporal deploy/temporal-temporal-server -- \
  temporal --address temporal-temporal-server-service:7233 \
  schedule describe --schedule-id velero-orphan-audit
```

If the workflow hasn't run in > 36h, the metric is stale — investigate the workflow first, not the orphans.

## Step 2: Independently identify orphans

Don't trust the alert without verifying. The orphan diff is `(set of ZFS snapshots) MINUS (set of live Velero Backup CR names)` per dataset, plus the analogous diff for R2 prefixes.

### Local ZFS snapshots

```bash
NODE_POD=$(kubectl -n openebs get pod -l role=openebs-zfs,app=openebs-zfs-node -o jsonpath='{.items[0].metadata.name}')
LIVE=$(velero backup get -o json | jq -r '.items[]? | .metadata.name' | sort -u)

kubectl -n openebs exec -i $NODE_POD -c openebs-zfs-plugin -- sh -c '
  echo "$1" | sort -u > /tmp/live.txt
  zfs list -H -o name -r zfspv-pool-nvme zfspv-pool-hdd 2>/dev/null \
    | grep "/pvc-" | grep -v "@" > /tmp/datasets.txt
  while read ds; do
    zfs list -t snapshot -H -o name "$ds" 2>/dev/null | sed "s|.*@||" | sort -u > /tmp/snaps.txt
    [ ! -s /tmp/snaps.txt ] && continue
    ORPH=$(comm -23 /tmp/snaps.txt /tmp/live.txt)
    [ -z "$ORPH" ] && continue
    echo "## $ds"
    echo "$ORPH" | sed "s|^|  $ds@|"
  done < /tmp/datasets.txt
' -- "$LIVE"
```

Output groups orphans by dataset. Save it to a file (`/tmp/orphans-local.txt`) and **review before proceeding**.

> **Reading the orphan set — which failure mode?** If every orphan shares the **same snapshot suffix**
> (e.g. all `…@monthly-backup-20260301050003`, one per PVC), this is the **TTL-finalizer mode**: a
> single backup's TTL expired and the plugin's `DeleteSnapshot` finalizer failed to destroy the ZFS
> snapshots. It's safe to prune — the parent Backup CR is gone by definition. If orphans span **many
> different suffixes/dates**, suspect the **re-deploy mode** (Backup CRs removed while the controller
> was absent); double-check you're not mid-re-deploy before pruning.

### R2 orphan prefixes

Generate a reviewed manifest with the operator-only cleanup tool:

```bash
cd packages/homelab/src/cdk8s
op run -- bun run r2:orphans -- inspect \
  --manifest /tmp/r2-orphans.json \
  --hold-backup 6hourly-backup-20260728001550
```

The manifest protects the union of live `Backup` CR names and backup metadata
under `torvalds/backups/`. It only proposes per-backup prefixes under
`zfspv-incr/backups/` whose newest object is more than 24 hours old. Review
every candidate, byte count, object count, and newest timestamp before
continuing. `--hold-backup` may be repeated; held prefixes are recorded in the
manifest, shown as protected, and excluded from bulk deletion. The hold must
exist in the R2 listing or inspection fails closed.

For a separately reviewed single-prefix cleanup, use `--only-backup` on both
`inspect` and `apply`. It requires that the selected prefix exists, is older
than the 24-hour fence, and is not protected by live Velero metadata or a
`Backup` CR.

## Step 3: Sanity-check before destroying

| Check                   | What to verify                                                                  | If unexpected                                                             |
| ----------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Live Backup CRs         | `velero backup get \| wc -l` matches recent expectation (e.g. 25–35 backups)    | Investigate before pruning — Velero state may be the problem, not orphans |
| Workflow last-run       | `temporal schedule describe ...` shows recent successful runs                   | The metric may be stale                                                   |
| Newest orphan timestamp | All orphans should pre-date the last legitimate Velero re-deploy / install date | If orphans are recent, investigate why                                    |
| Dataset live count      | Each dataset's live snapshot count ≥ matches its expected schedule subscription | If 0 live, the volume may have lost backup labels                         |

If any check fails, **stop and investigate**.

## Step 4: Prune local ZFS orphans

For each orphan in `/tmp/orphans-local.txt`, run:

```bash
NODE_POD=$(kubectl -n openebs get pod -l role=openebs-zfs,app=openebs-zfs-node -o jsonpath='{.items[0].metadata.name}')

# Dry-run first: show what would be destroyed
kubectl -n openebs exec -i $NODE_POD -c openebs-zfs-plugin -- sh -c '
  while read snap; do
    [ -z "$snap" ] && continue
    case "$snap" in
      "  "*) snap="${snap#  }" ;;
      "## "*) continue ;;
    esac
    echo "would: zfs destroy $snap"
  done
' < /tmp/orphans-local.txt | head -30
```

Once the list looks right, execute:

```bash
kubectl -n openebs exec -i $NODE_POD -c openebs-zfs-plugin -- sh -c '
  i=0
  while read snap; do
    [ -z "$snap" ] && continue
    case "$snap" in
      "  "*) snap="${snap#  }" ;;
      "## "*) continue ;;
    esac
    i=$((i + 1))
    if zfs destroy "$snap" 2>/dev/null; then
      echo "[$i] ok $snap"
    else
      echo "[$i] FAIL $snap" >&2
    fi
  done
' < /tmp/orphans-local.txt
```

`zfs destroy` is fast (no block scrub). Failures are usually:

- Snapshot already gone (raced with a concurrent backup) — safe to skip
- Snapshot is the most-recent on its chain and the plugin is mid-incremental — re-check after a few minutes

## Step 5: Prune R2 orphans

Apply exactly the reviewed manifest:

```bash
cd packages/homelab/src/cdk8s
op run -- bun run r2:orphans -- apply \
  --manifest /tmp/r2-orphans.json \
  --hold-backup 6hourly-backup-20260728001550 \
  --apply
```

The command re-lists live Backup CRs, backup metadata, and every ZFS backup
object before deleting anything and again before each prefix. Any drift from
the reviewed manifest aborts the operation. Non-interactive use additionally
requires `--yes`. After deletion it verifies that no object remains under any
approved prefix. The hold list must exactly match the inspection command.

When a held R2 prefix is intentionally paired with a local orphan snapshot,
complete the bulk cleanup first, then create and apply a single-prefix
manifest:

```bash
op run -- bun run r2:orphans -- inspect \
  --manifest /tmp/r2-held.json \
  --only-backup 6hourly-backup-20260728001550
op run -- bun run r2:orphans -- apply \
  --manifest /tmp/r2-held.json \
  --only-backup 6hourly-backup-20260728001550 \
  --apply \
  --yes
```

Only after the guarded R2 command succeeds, destroy the exact local snapshot
that was reviewed with it. Do not delete the dataset, PV, or PVC:

```bash
NODE_POD=$(kubectl -n openebs get pod \
  -l role=openebs-zfs,app=openebs-zfs-node \
  --field-selector spec.nodeName=torvalds \
  -o jsonpath='{.items[0].metadata.name}')
kubectl -n openebs exec -i "$NODE_POD" \
  -c openebs-zfs-plugin -- \
  zfs destroy \
  'zfspv-pool-nvme/pvc-22eaf2de-13ce-402a-ac35-cdaf006cb438@6hourly-backup-20260728001550'
```

If R2 deletion fails, do not destroy the local snapshot. If the local destroy
fails after R2 deletion, preserve the dataset and report the exact residual.

## Step 6: Verify post-prune state

```bash
# Local: each dataset's snapshot count should now match its live Backup count
LIVE=$(velero backup get -o json | jq -r '.items[]? | .metadata.name' | sort -u)
NODE_POD=$(kubectl -n openebs get pod -l role=openebs-zfs,app=openebs-zfs-node -o jsonpath='{.items[0].metadata.name}')
kubectl -n openebs exec -i $NODE_POD -c openebs-zfs-plugin -- sh -c '
  echo "$1" | sort -u > /tmp/live.txt
  zfs list -H -o name -r zfspv-pool-nvme zfspv-pool-hdd 2>/dev/null \
    | grep "/pvc-" | grep -v "@" | while read ds; do
    n=$(zfs list -t snapshot -H -o name "$ds" 2>/dev/null | sed "s|.*@||" \
        | sort -u | comm -23 - /tmp/live.txt | wc -l)
    [ "$n" -gt 0 ] && echo "  $ds has $n orphans remaining"
  done
  echo "done"
' -- "$LIVE"

# R2: a fresh inspection should contain zero candidates
cd packages/homelab/src/cdk8s
op run -- bun run r2:orphans -- inspect --manifest /tmp/r2-postcheck.json
```

Both should report 0. The next workflow run will confirm:

```bash
kubectl exec -n temporal deploy/temporal-temporal-server -- \
  temporal --address temporal-temporal-server-service:7233 \
  schedule trigger --schedule-id velero-orphan-audit
```

Wait a few minutes, then re-query the metrics:

```bash
toolkit prom query 'velero_orphan_local_snapshots_total'
```

The PagerDuty alerts auto-resolve once the metrics stay at 0 for the alert's `for:` window (default 24h, but the underlying alert clears as soon as Prometheus sees the new value).

## Common pitfalls

- **Don't run this immediately after a Velero re-deploy.** Wait at least 5 minutes for `BackupSyncController` to recreate Backup CRs from R2 metadata. Otherwise you'll see the entire backup set as "orphan" and might delete recoverable state. The workflow's 24h `for:` window naturally guards against this; if you're running manually, mind the timing.
- **Don't strip `metadata.finalizers` from Backup CRs to "fix" stuck deletions.** That's exactly how the original orphan event happened. If a Backup CR is stuck, debug the plugin instead.
- **Don't `zfs destroy -R`.** Recursive destroy would also delete child datasets and clones. Always destroy individual snapshots only.
- **Don't bypass the guarded R2 tool with an ad-hoc `aws s3 rm`.** The reviewed manifest, metadata union, age fence, and apply-time revalidation are the safety boundary.
- **Don't bypass Step 3.** A bug in the audit workflow could mark live state as orphan. The "verify before destroy" step exists to catch that.

## Re-deploying Velero correctly

If the trigger for orphan accumulation was a Velero re-deploy, follow this procedure next time to prevent recurrence:

1. **Drain backups first:**

   ```bash
   velero backup delete --all --confirm
   # Wait for plugin finalizers to fully run
   while [ $(velero backup get -o json | jq '.items | length') -gt 0 ]; do
     echo "waiting for $(velero backup get -o json | jq '.items | length') backups to finish deleting..."
     sleep 10
   done
   ```

2. **Verify zero orphans before tear-down** (use Step 2 of this runbook).
3. **Then** uninstall / re-deploy Velero.

## Cross-References

- Workflow source: `packages/temporal/src/workflows/velero-orphan-audit.ts`
- Alert rules: `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/velero.ts`
