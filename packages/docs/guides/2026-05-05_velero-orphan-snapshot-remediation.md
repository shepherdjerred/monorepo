# Velero Orphan-Snapshot Remediation Runbook

Procedure for manually pruning orphan ZFS snapshots and R2 objects detected by the `velero-orphan-audit` Temporal workflow. See [the prevention decision doc](../decisions/2026-05-05_velero-orphan-snapshot-prevention.md) for background on why orphans occur and why this is manual rather than automated.

## When to use this runbook

Trigger any of these:

- PagerDuty fires `VeleroOrphanLocalSnapshots` (orphan ZFS snapshots present > 24h)
- PagerDuty fires `VeleroOrphanR2Objects` (orphan R2 objects under `s3://homelab/zfspv-incr/` present > 24h)
- PagerDuty fires `ZFSSnapshotCountExcessive` (any PVC dataset > 35 snapshots — backstop alert)
- A PVC reads `100%` full unexpectedly and `zfs list` shows large `USED` vs small `REFER` (snapshot bloat — same root cause)
- Velero was just re-deployed (helm uninstall + reinstall, ArgoCD app re-creation, etc.)

## Prerequisites

```bash
kubectl version          # must reach the cluster
velero backup get        # must list current Backup CRs
aws --version            # local CLI present
```

R2 credentials extracted from the `cloud-credentials` secret in the `velero` namespace:

```bash
CREDS=$(kubectl -n velero get secret cloud-credentials -o jsonpath='{.data.cloud}' | base64 -d)
export AWS_ACCESS_KEY_ID=$(echo "$CREDS" | grep aws_access_key_id | cut -d= -f2 | tr -d ' ')
export AWS_SECRET_ACCESS_KEY=$(echo "$CREDS" | grep aws_secret_access_key | cut -d= -f2 | tr -d ' ')
export AWS_REGION=auto
ENDPOINT="https://48948ed6cd40d73e34d27f0cc10e595f.r2.cloudflarestorage.com"
```

## Step 1: Verify the orphan finding

The audit workflow surfaces orphan counts via these Prometheus metrics:

- `velero_orphan_local_snapshots{dataset="..."}`
- `velero_orphan_local_bytes{dataset="..."}`
- `velero_orphan_r2_objects`
- `velero_orphan_r2_bytes`

Confirm with `toolkit gf query` and cross-check independently before destroying anything.

```bash
toolkit gf query 'velero_orphan_local_snapshots'
toolkit gf query 'velero_orphan_r2_objects'
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

### R2 orphan prefixes

```bash
LIVE=$(velero backup get -o json | jq -r '.items[]? | .metadata.name' | sort -u)
aws s3 ls s3://homelab/zfspv-incr/backups/ --endpoint-url=$ENDPOINT \
  | awk '{print $2}' | sed 's|/$||' | sort -u > /tmp/r2-prefixes.txt
echo "$LIVE" | sort -u > /tmp/live.txt
comm -23 /tmp/r2-prefixes.txt /tmp/live.txt > /tmp/orphans-r2.txt
echo "Orphan R2 backup prefixes: $(wc -l < /tmp/orphans-r2.txt)"
head /tmp/orphans-r2.txt
```

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

For each orphan prefix in `/tmp/orphans-r2.txt`:

```bash
i=0
total=$(wc -l < /tmp/orphans-r2.txt)
while read prefix; do
  [ -z "$prefix" ] && continue
  i=$((i + 1))
  echo "[$i/$total] aws s3 rm s3://homelab/zfspv-incr/backups/$prefix/ --recursive"
  aws s3 rm "s3://homelab/zfspv-incr/backups/$prefix/" \
    --recursive \
    --endpoint-url=$ENDPOINT \
    --quiet
done < /tmp/orphans-r2.txt
```

R2 charges per Class A operation (DELETE) — for tens of thousands of objects, expect a small operations bill (~$0.01–$0.10).

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

# R2: orphan prefix count should be 0
LIVE=$(velero backup get -o json | jq -r '.items[]? | .metadata.name' | sort -u)
aws s3 ls s3://homelab/zfspv-incr/backups/ --endpoint-url=$ENDPOINT \
  | awk '{print $2}' | sed 's|/$||' | sort -u > /tmp/r2-prefixes.txt
echo "$LIVE" | sort -u > /tmp/live.txt
echo "Remaining R2 orphans: $(comm -23 /tmp/r2-prefixes.txt /tmp/live.txt | wc -l)"
```

Both should report 0. The next workflow run will confirm:

```bash
kubectl exec -n temporal deploy/temporal-temporal-server -- \
  temporal --address temporal-temporal-server-service:7233 \
  schedule trigger --schedule-id velero-orphan-audit
```

Wait a few minutes, then re-query the metrics:

```bash
toolkit gf query 'velero_orphan_local_snapshots'
toolkit gf query 'velero_orphan_r2_objects'
```

The PagerDuty alerts auto-resolve once the metrics stay at 0 for the alert's `for:` window (default 24h, but the underlying alert clears as soon as Prometheus sees the new value).

## Common pitfalls

- **Don't run this immediately after a Velero re-deploy.** Wait at least 5 minutes for `BackupSyncController` to recreate Backup CRs from R2 metadata. Otherwise you'll see the entire backup set as "orphan" and might delete recoverable state. The workflow's 24h `for:` window naturally guards against this; if you're running manually, mind the timing.
- **Don't strip `metadata.finalizers` from Backup CRs to "fix" stuck deletions.** That's exactly how the original orphan event happened. If a Backup CR is stuck, debug the plugin instead.
- **Don't `zfs destroy -R`.** Recursive destroy would also delete child datasets and clones. Always destroy individual snapshots only.
- **Don't `aws s3 rm` without `--recursive` on a prefix.** R2 returns a "directory" listing as a single empty object; you must recurse to actually free the data.
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

- [Decision: Velero orphan-snapshot prevention](../decisions/2026-05-05_velero-orphan-snapshot-prevention.md) — why this is manual
- Workflow source: `packages/temporal/src/workflows/velero-orphan-audit.ts`
- Alert rules: `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/velero.ts`
