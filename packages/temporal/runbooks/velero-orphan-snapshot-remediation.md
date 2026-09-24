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

## Appendix: orphan ZFSBackup CRs (etcd bloat)

The same audit workflow also lists `zfsbackups.zfs.openebs.io` CRs in
`openebs` and reports `velero_orphan_backup_crs_total` — CRs whose parent
Velero Backup is gone and which are older than the 24h fence. Unpruned CRs
bloat etcd (1,797 orphans drove the DB to 516 MiB / 16% in-use in 2026-09 and
fired `EtcdHighFragmentation`). Remediation stays manual, same as snapshots.

Trigger: `VeleroOrphanBackupCRs` (any, > 24h) or
`VeleroOrphanBackupCRsExcessive` (> 100, > 24h).

### Prune predicate

Orphan = CR name suffix (after the single `.` in `<pv-name>.<backup-name>`)
matches no live `backups.velero.io` name AND `creationTimestamp` is older
than 24h. Status is not part of the predicate. Unparseable names stay out of
the prune list. The Temporal `temporal-backup-preflight` hook only reads the
newest `6hourly-backup`'s per-PV object, which is always live, so the
live-name check subsumes its needs — but re-verify the hook inputs below
before and after.

Deleting a CR is the same path Velero TTL expiry takes (the plugin deletes
only the CR): the zfs-localpv controller then `zfs destroy`s the matching
local snapshot and drops the finalizer. Already-absent snapshots and deleted
volumes succeed silently, so this also reaps any corresponding local orphan
snapshots. R2 data is untouched — handle it via Step 5 if the R2 inspection
flags the same backups.

### Procedure

```bash
# 1. Inventory (read-only). Expect: newest 6hourly Completed < 7h old,
# 48/48 snapshots, its <pv>.<backup> ZFSBackup Done.
kubectl get zfsbackups.zfs.openebs.io -n openebs -o json > /tmp/zfsbackups.json
velero backup get -o json | jq -r '.items[].metadata.name' | sort -u > /tmp/live.txt
talosctl etcd status  # record DB SIZE vs IN USE

# 2. Build the reviewed manifest (orphans) + blocked list (live/young/unparseable).
# Keep the manifest file for the whole operation; every delete below names it.
bun -e '
const live = new Set((await Bun.file("/tmp/live.txt").text()).split("\n").map((s) => s.trim()).filter(Boolean));
const items = (await Bun.file("/tmp/zfsbackups.json").json()).items ?? [];
const now = Date.now(), fence = 24 * 3600 * 1000, orphan = [], blocked = [];
for (const it of items) {
  const name = it.metadata?.name ?? "";
  const parts = name.split(".");
  const suffix = parts.length === 2 ? parts[1] : "";
  if (!suffix || live.has(suffix)) { blocked.push(name); continue; }
  const age = now - Date.parse(it.metadata?.creationTimestamp ?? "");
  (Number.isFinite(age) && age > fence ? orphan : blocked).push(name);
}
await Bun.write("/tmp/orphan-manifest.txt", orphan.sort().join("\n") + "\n");
await Bun.write("/tmp/orphan-blocked.txt", blocked.sort().join("\n") + "\n");
console.log(`orphan=${orphan.length} blocked=${blocked.length}`);
'

# 3. Snapshot etcd first (point-in-time restore artifact; retain until done).
talosctl etcd snapshot etcd-pre-prune-$(date +%Y%m%d).snapshot

# 4. Canary: delete the single oldest manifest entry, confirm it leaves
# Terminating within minutes with no controller error storm. If it sticks, stop.
head -n 1 /tmp/orphan-manifest.txt | xargs kubectl delete zfsbackups.zfs.openebs.io -n openebs

# 5. Waves of ~250, oldest first, 30s pauses. After each wave: no CR
# Terminating older than 15m, live backup count sane (25-35), no new firing
# backup alerts. Any violation stops the line.
while [ -s /tmp/orphan-manifest.txt ]; do
  head -n 250 /tmp/orphan-manifest.txt | xargs kubectl delete zfsbackups.zfs.openebs.io -n openebs --ignore-not-found
  tail -n +251 /tmp/orphan-manifest.txt > /tmp/orphan-rest.txt && mv /tmp/orphan-rest.txt /tmp/orphan-manifest.txt
  sleep 30
done

# 6. Verify: zero orphans, zero stuck, live set intact.
kubectl get zfsbackups.zfs.openebs.io -n openebs -o json \
  | jq '[.items[] | select(.metadata.deletionTimestamp != null)] | length'
```

Do not strip finalizers to clear a stuck deletion — debug the plugin or
controller instead. Expect the next backups per schedule to go full (the
incremental grouping math resets when old `Done` CRs disappear): slower
backups are acceptable, a failed backup is a stop-and-investigate signal.

### Defrag after the prune

Pruning marks space free; only a defrag reclaims it. With the prune complete
and no backup running:

```bash
talosctl etcd defrag  # blocks API reads/writes on the single member while rebuilding
talosctl etcd status  # DB SIZE should now ≈ IN USE
toolkit prom query 'etcd_mvcc_db_total_size_in_use_in_bytes / etcd_mvcc_db_total_size_in_bytes'  # want > 0.2
```

`EtcdHighFragmentation` clears once the ratio recovers. Retain the step-3
etcd snapshot until the alert clears.

## Cross-References

- Workflow source: `packages/temporal/src/workflows/homelab/velero-orphan-audit.ts`
- Alert rules: `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/storage/velero.ts`
