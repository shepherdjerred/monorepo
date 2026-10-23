---
title: Restore the Delivery record
description: Rebuild the homelab from an empty cluster, or recover a lost Delivery or Temporal database, from the cold-start snapshot and off-cluster archives, then reconcile the record with what runs.
sidebar:
  order: 8
---

Use this guide when the cluster is empty, or when Delivery's or Temporal's
database is lost or damaged while workloads keep running.

Both paths end with reconcile-after-restore. It compares Delivery's record, the
cold-start snapshot and each live target, and holds every environment that
disagrees ([section 6](packages/delivery/docs/model.md#6-flows)).

## What you restore from

| Source              | Location                                       | Restores                                                                                                     |
| ------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Cold-start snapshot | `s3://homelab/delivery-cold-start/latest.json` | Every environment's accepted selection                                                                       |
| WAL-G archive       | `s3://homelab/postgres-wal/<cluster>/`         | Each cluster to a point in time ([PC2](packages/delivery/docs/model.md#2-guarantees))                        |
| Velero snapshots    | The `homelab` bucket's Velero backups          | Each cluster's volume as of its last snapshot                                                                |
| Artifact replica    | R2 bucket `seaweedfs-backups`                  | `delivery-artifacts` ([PC1](packages/delivery/docs/model.md#2-guarantees))                                   |
| Catalog document    | The assembled catalog of `main` in Git         | Every recipe and configuration revision the snapshot names ([P1](packages/delivery/docs/model.md#47-recipe)) |

The backup worker rewrites `latest.json` on each acceptance of a
bootstrap-chain environment. It keeps every version as an immutable
`delivery-cold-start/<timestamp>-<catalogRevision>.json` and stores its
fingerprint as object metadata. The snapshot sets observed selections only. It
never sets an accepted pointer
([X7](packages/delivery/docs/model.md#9-decisions)). Delivery holds no R2
credential, so you read the snapshot with the `r2` AWS profile and hand it to
Delivery yourself.

The two archived clusters are `delivery-postgresql` in namespace `delivery` and
`temporal-postgresql` in namespace `temporal`. The
[backup reference](/reference/seaweedfs-backups/) lists the artifact replica's
coverage.

## 1. Freeze automatic deployment

Skip this step on an empty cluster; Temporal is not running yet.

1. Pause the dispatch Schedule so no deployment is claimed:

   ```bash
   toolkit temporal --namespace prod schedule toggle --schedule-id delivery-dispatch --pause --reason "Restoring the Delivery record"
   ```

2. Turn the `delivery-writes-enabled` flag off in Flipt. The API then admits no
   new effect.

## 2. Fetch the cold-start snapshot

Fetch `latest.json`. The command reads R2 directly with the `r2` AWS profile,
so it works while Delivery is down:

```bash
toolkit deploy snapshot --output /private/cold-start.json
```

Keep the file outside the checkout. It names, for each environment, the set
revision, recipe revision and configuration revision to replay.

Keep the catalog document assembled from `main` beside it as
`/private/catalog.json`.
`render-application` reads each recipe and configuration revision from it.

## 3. Rebuild an empty cluster

Skip to [step 4](#4-restore-the-databases) if the cluster still runs.
Otherwise walk the bootstrap chain in this order. Each layer is created at the
selection the snapshot records for its environment.

1. Install Talos on each node and bootstrap Kubernetes, following the
   [Talos installation](packages/homelab/README.md#talos).
2. Create the ZFS pools, following the
   [ZFS installation](packages/homelab/README.md#zfs).
3. Install ArgoCD and the 1Password Connect credentials, following the
   [Kubernetes installation](packages/homelab/README.md#kubernetes).
4. Create the Application of each chain environment in this order: OpenEBS,
   cert-manager, Tailscale, cloudflare-operator, ChartMuseum, the PostgreSQL
   operator, SeaweedFS. Render each one from the snapshot, apply it, and wait
   until it reports Healthy:

   ```bash
   toolkit deploy render-application ENVIRONMENT --snapshot /private/cold-start.json --file /private/catalog.json > /private/cold-start/APPLICATION.json
   kubectl --context admin@torvalds apply --server-side -f /private/cold-start/APPLICATION.json
   kubectl --context admin@torvalds -n argocd wait applications.argoproj.io/APPLICATION --for=jsonpath='{.status.health.status}'=Healthy --timeout=30m
   ```

5. Restore `delivery-artifacts` into the new SeaweedFS from its newest
   completed recovery point. `--cold-start` lets the restore write a production
   bucket that is still empty
   ([seaweedfs-backup README](packages/seaweedfs-backup/README.md)):

   ```bash
   toolkit backup seaweedfs snapshots
   toolkit backup seaweedfs restore --snapshot SNAPSHOT --bucket delivery-artifacts --destination-bucket delivery-artifacts --cold-start
   ```

6. Restore both databases from their WAL-G archives, as in
   [step 4](#4-restore-the-databases). Then create the `delivery-data/prod`
   and `temporal-data/prod` Applications the same way as in item 4.
7. Create the Woodpecker, Delivery, Temporal and Delivery control-plane
   Applications the same way, in that order.
8. As soon as Temporal is up, pause the dispatch Schedule as in
   [step 1](#1-freeze-automatic-deployment). The control plane must not claim
   work before reconciliation.

:::danger
Never create a data-layer Application before its cluster has been restored. A
new cluster initialises empty and archives into the same WAL-G prefix as the
cluster you are about to restore.
:::

:::caution
This is the only procedure in which an operator writes Application objects.
Delivery takes each one over on its next deployment of that environment.
:::

## 4. Restore the databases

Restore `delivery-postgresql`. Restore `temporal-postgresql` the same way when
Temporal's history is lost too.

Choose the source first:

| Source          | Use it when                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| WAL-G archive   | The archive holds a base backup older than your target time and its WAL chain is intact. Always on a cold start.    |
| Velero snapshot | The archive has no base backup before the target, `wal-verify` reports `FAILURE`, or the damage predates archiving. |

The archive keeps seven nightly base backups, so it reaches back about a week.
A Velero snapshot restores only to the moment it was taken.

### From the WAL-G archive

The Zalando operator restores by cloning: Spilo fetches the newest base backup
before the target time and replays archived WAL up to it
([Clone from S3](https://github.com/zalando/postgres-operator/blob/master/docs/user.md#clone-from-s3),
[`clone_with_walg`](https://github.com/zalando/spilo/blob/master/postgres-appliance/scripts/configure_spilo.py)).

1. If the cluster still runs, stop every writer, then list its base backups
   and check the archived WAL chain from the primary
   ([`backup-list`](https://github.com/wal-g/wal-g/blob/master/docs/README.md#backup-list),
   [`wal-verify`](https://github.com/wal-g/wal-g/blob/master/docs/PostgreSQL.md#wal-verify)):

   ```bash
   kubectl --context admin@torvalds -n delivery exec delivery-postgresql-0 -c postgres -- envdir /run/etc/wal-e.d/env wal-g backup-list --detail
   kubectl --context admin@torvalds -n delivery exec delivery-postgresql-0 -c postgres -- envdir /run/etc/wal-e.d/env wal-g wal-verify integrity
   ```

2. Choose the target time, in UTC with an explicit `+00:00`. It must come
   after the `finish_time` of a listed base backup and before the damage.

   On a cold start you cannot list the archive yet. Use the last time the
   cluster was known healthy, at least 30 minutes before it stopped. Spilo
   archives a partial segment every 30 minutes (`archive_timeout`), so later
   writes may not be in the archive. If unknown, use the snapshot's timestamp.

   PostgreSQL stops with a fatal error when the archive ends before the target
   ([recovery targets](https://www.postgresql.org/docs/current/runtime-config-wal.html#RUNTIME-CONFIG-WAL-RECOVERY-TARGET)).
   If that happens, delete the new `postgresql` object and retry with an
   earlier target.

3. If the cluster still runs, keep its manifest and volume, then delete it.
   Deleting the `postgresql` object also deletes its volume claim and
   credential Secrets
   ([Restore in place](https://github.com/zalando/postgres-operator/blob/master/docs/user.md#restore-in-place),
   [deletion defaults](https://github.com/zalando/postgres-operator/blob/master/docs/reference/operator_parameters.md)):

   ```bash
   kubectl --context admin@torvalds -n delivery get postgresql delivery-postgresql -o yaml > /private/delivery-postgresql.yaml
   velero --kubecontext admin@torvalds backup create delivery-postgresql-before-restore --include-namespaces delivery --wait
   kubectl --context admin@torvalds -n argocd get applications.argoproj.io delivery-data -o jsonpath='{.spec.syncPolicy.automated}'
   kubectl --context admin@torvalds -n argocd patch applications.argoproj.io delivery-data --type json -p '[{"op":"remove","path":"/spec/syncPolicy/automated"}]'
   kubectl --context admin@torvalds -n delivery delete postgresql delivery-postgresql
   ```

   Data-layer Applications never sync automatically, so the read should print
   nothing. Run the patch only if it prints a policy: an automatically synced
   data-layer Application would recreate the deleted cluster empty, and the
   new cluster would archive into the same WAL-G prefix.

   On a cold start, build the data-layer chart instead. Apply every object in
   `dist/delivery-data.k8s.yaml` (or `dist/temporal-data.k8s.yaml`) except the
   `postgresql` object, which you take from the same file. That creates the
   namespace and the `delivery-postgresql-wal-archive` Secret the clone reads:

   ```bash
   bun run --cwd packages/homelab/src/cdk8s build
   ```

4. Add a `clone` section and the clone credentials to that manifest. Remove
   `metadata.uid`, `metadata.resourceVersion` and `status` from a saved live
   manifest. Take the endpoint from `POSTGRES_WAL_ARCHIVE.endpoint` in
   `packages/homelab/src/cdk8s/src/resources/postgres/wal-archive.ts`. Keep
   `postgresql.version` equal to the archived cluster's major version. Save the
   result as `/private/delivery-postgresql-clone.yaml`.

   ```yaml
   spec:
     clone:
       cluster: delivery-postgresql
       timestamp: "TARGET_TIME+00:00"
       s3_wal_path: s3://homelab/postgres-wal/delivery-postgresql
       s3_endpoint: ARCHIVE_ENDPOINT
       s3_force_path_style: true
     env:
       # Keep the existing archive variables and append:
       - name: CLONE_USE_WALG_RESTORE
         value: "true"
       - name: CLONE_AWS_REGION
         value: auto
       - name: CLONE_AWS_ACCESS_KEY_ID
         valueFrom:
           secretKeyRef:
             name: delivery-postgresql-wal-archive
             key: CLOUDFLARE_R2_ACCESS_KEY_ID
       - name: CLONE_AWS_SECRET_ACCESS_KEY
         valueFrom:
           secretKeyRef:
             name: delivery-postgresql-wal-archive
             key: CLOUDFLARE_R2_SECRET_ACCESS_KEY
   ```

   With `s3_wal_path` set, the operator ignores `uid`. The `CLONE_` variables
   come from the existing archive Secret, so no key enters the manifest
   ([clone parameters](https://github.com/zalando/postgres-operator/blob/master/docs/reference/cluster_manifest.md#parameters-defining-how-to-clone-the-cluster-from-another-one),
   [clone environment](https://github.com/zalando/postgres-operator/blob/master/docs/administrator.md#restoring-physical-backups)).

5. Create the cluster and wait until it is running and out of recovery:

   ```bash
   kubectl --context admin@torvalds -n delivery create -f /private/delivery-postgresql-clone.yaml
   kubectl --context admin@torvalds -n delivery get postgresql delivery-postgresql -o jsonpath='{.status.PostgresClusterStatus}'
   kubectl --context admin@torvalds -n delivery exec delivery-postgresql-0 -c postgres -- psql -U postgres -tAc 'select pg_is_in_recovery()'
   ```

   The status must read `Running` and the query must return `f`. The restored
   cluster continues archiving on a new timeline, so it never overwrites the
   segments it was restored from.

6. Restart the cluster's clients so they read the regenerated credential
   Secrets. The data-layer Application's next sync drops the `clone` section,
   which has no effect on a running cluster.

### From a Velero snapshot

Follow
[Verify an independent offsite restore](/how-to/upgrade-a-homelab-postgresql-major-version/#2-verify-an-independent-offsite-restore)
with the source and restore volumes the
[Delivery catalog recovery](packages/temporal/README.md#delivery-execution)
names. It restores the volume into an isolated namespace and verifies it
before any writer sees it. On a cold start, create the Velero Application first, the same
way as the chain in step 3.

### Start the API

Start the Delivery API, or let its Application from step 3 start it, and
confirm its migrations complete.

## 5. Reconcile the record against the snapshot

1. Run reconcile-after-restore with the admin credential:

   ```bash
   toolkit deploy snapshot reconcile --machine --json
   ```

   The command reads `latest.json` and its immutable copy with the `r2`
   profile. It refuses unless they are identical and carry the writer's
   fingerprint, then sends that snapshot to Delivery. Delivery checks the
   fingerprint and the copy's key before comparing.

   Every environment reports `match` or `held`, with its record, snapshot and
   live selections and the reason for a hold. A held environment receives no
   automatic deployment, and the command exits 1 while any environment is
   held.

2. Resolve each held environment with evidence. To keep what is live, accept
   it and name what you inspected:

   ```bash
   toolkit deploy snapshot accept ENVIRONMENT --reason "Why the live state is right" --evidence "What was inspected" --machine
   ```

   Delivery records that as `reconciliation` evidence on the accepted
   deployment and clears the hold. The accepted pointer does not move.

   To return the environment to a recorded selection instead, roll back to it.
   Its acceptance clears the hold:

   ```bash
   toolkit deploy candidates ENVIRONMENT --json
   toolkit deploy rollback ENVIRONMENT DEPLOYMENT_ID --json
   ```

3. Confirm on the hub's environment pages that no environment still shows a
   restore hold.

## 6. Resume

1. Turn `delivery-writes-enabled` back on in Flipt.
2. Resume the dispatch Schedule:

   ```bash
   toolkit temporal --namespace prod schedule toggle --schedule-id delivery-dispatch --unpause --reason "Delivery record reconciled"
   ```

3. Confirm the next acceptance of a bootstrap-chain environment writes a new
   `delivery-cold-start/latest.json`.

## Related

- [Why releases are shaped this way](/explanation/homelab/release-safety/)
- [Cut a homelab release](/how-to/cut-a-homelab-release/)
- [Delivery model reference](/reference/delivery-model/)
- [Restore a SeaweedFS backup](/how-to/restore-a-seaweedfs-backup/)
