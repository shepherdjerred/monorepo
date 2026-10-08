---
title: Upgrade a homelab PostgreSQL major version
description: Verify recovery, publish matching source pins, and upgrade one live database at a time.
sidebar:
  order: 13
---

Complete the source change and matching live PostgreSQL upgrade in one delivery,
with a verified independent restore before changing production data.

## 1. Inspect each target

Read the cluster manifest and current server version. Use the namespaces and
database names in [Connect to a homelab database](/how-to/connect-to-a-homelab-database/).

```bash
kubectl get postgresql -A \
  -o custom-columns='NAMESPACE:.metadata.namespace,CLUSTER:.metadata.name,TARGET:.spec.postgresql.version,MEMBERS:.spec.numberOfInstances'
kubectl exec -n temporal temporal-postgresql-0 -c postgres -- \
  su postgres -c 'psql -XAt -d postgres -c "SHOW server_version; SHOW data_checksums;"'
```

Record the exact PVC, PV, volume handle, storage class, extensions, database
sizes, and writer workloads. Keep the inventory and acceptance results in the PR.

The [database source definitions](https://github.com/shepherdjerred/monorepo/tree/main/packages/homelab/src/cdk8s/src/resources/postgres)
and [operator configuration](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/argo-applications/platform/postgres-operator.ts)
own the desired state.

## 2. Verify an independent offsite restore

Create a standalone full backup of the selected database's PV and PVC. Wait for
the volume snapshot to finish; a completed backup record alone is insufficient.
Restore only those resources into an isolated namespace with no application
controllers, credentials, service-account token, or network access.

Classify the exact restore namespace and PVC name in the
[backup policy](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/backup-policy/pvc-backup-policy.json)
and deploy its admission rules through the repository release workflow first.
The disposable copy is excluded from new backups; the source remains included.
Do not disable admission to make a restore pass.

Confirm that the restored PV has a different volume handle from production.
Start only PostgreSQL on the copy, with no TCP listener and read-only
transactions. Verify recovery, extensions, and application-table counts without
printing row contents. Stop the copy and validate its enabled page checksums.

Run [`pg_upgrade --check`](https://www.postgresql.org/docs/18/pgupgrade.html)
with both server toolchains and a separately initialized target directory.
Use the same Spilo image as the intended live upgrade. Fix any extension or
compatibility error before proceeding.

Initialize the target with the restored cluster's locale and checksum setting.
Pass production's `shared_preload_libraries` through `--new-options` when
checking the target. Extensions such as `pg_stat_kcache` require loading at
startup. Keep the temporary server's TCP listener disabled.

:::caution[Check the entire snapshot chain]
An incremental snapshot needs its full base. A restore that receives only a
volume, or reports `PartiallyFailed`, does not prove database recovery. Keep the
independent full backup and verified restore available throughout the upgrade.
:::

## 3. Control when the major upgrade starts

Inspect the live operator mode before publishing all database pins together:

```bash
kubectl get operatorconfiguration -n postgres-operator postgres-operator \
  -o jsonpath='{.configuration.major_version_upgrade.major_version_upgrade_mode}{"\n"}'
```

For a serialized maintenance window, declare `major_version_upgrade_mode: off`
in the operator's repository Helm values before reconciling the database pins.
This policy change needs the owner's decision. Verify the live mode before
continuing.

The operator's [`manual` mode](https://postgres-operator.readthedocs.io/en/latest/administrator/#in-place-major-version-upgrade)
runs the upgrade when a manifest changes. `off` leaves the old server running
until a human operator invokes the Spilo upgrade script.

Update the database source pins and local/CI toolchain together. Complete
focused checks and exact-head Woodpecker CI. Publish and reconcile through
[Cut a homelab release](/how-to/cut-a-homelab-release/).

## 4. Upgrade and accept one database

Stop the selected database's writers through their approved maintenance path.
Take a final consistent independent backup. Confirm its pod's `PGVERSION`
matches the new source pin and that both toolchains are present.

For a single-member cluster, invoke the documented Spilo entrypoint:

```bash
kubectl exec -n temporal temporal-postgresql-0 -c postgres -- \
  python3 /scripts/inplace_upgrade.py 1
```

Verify the actual server version, Patroni leader state, checksums, extensions,
database sizes, and required table counts. Resume writers and exercise the
owning application's real read/write flow. Inspect errors and migrations before
starting the next database. Upgrade the CI service's own database after running
builds have settled.

:::danger[Rollback requires the independent copy]
After a link-mode upgrade starts the new server, the old directory is not a
rollback target. Stop writers and restore the verified independent backup.
Reconcile the source and account for any writes accepted after the backup.
:::

Record source checks, CI, artifact publication, ArgoCD reconciliation, and live
acceptance separately. A newer manifest pin does not prove a newer server.

## Related

- [Connect to a homelab database](/how-to/connect-to-a-homelab-database/)
- [Pull a Scout database into local dev](/how-to/pull-a-scout-database-into-local-dev/)
- [Cut a homelab release](/how-to/cut-a-homelab-release/)
