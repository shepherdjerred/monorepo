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

Inspect the installed Spilo upgrade helpers for extension removal and unlogged
table truncation. Confirm that no application data depends on those objects
before invoking the upgrade.

The [database source definitions](https://github.com/shepherdjerred/monorepo/tree/main/packages/homelab/src/cdk8s/src/resources/postgres)
and [operator configuration](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/argo-applications/platform/postgres-operator.ts)
own the desired state.

## 2. Verify an independent offsite restore

Create a standalone full backup of the selected database's PV and PVC. Wait for
the volume snapshot to finish; a completed backup record alone is insufficient.
Restore only those resources into an isolated namespace with no application
controllers, credentials, or service-account token.

Classify the exact restore namespace and PVC name in the
[backup policy](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/backup-policy/pvc-backup-policy.json)
and deploy its admission rules through the repository release workflow first.
The disposable copy is excluded from new backups; the source remains included.
Do not disable admission to make a restore pass.

### Restore the volume

Save this Restore as `restore.yaml` and replace its placeholders.
`SOURCE_NAMESPACE` is the database's namespace. `RECOVERY_NAMESPACE` is the
classified restore namespace. Keep `RESTORE_NAME` within 63 characters, because
Velero shortens longer names in the label checked below.

```yaml
apiVersion: velero.io/v1
kind: Restore
metadata:
  name: RESTORE_NAME
  namespace: velero
spec:
  backupName: BACKUP_NAME
  includedNamespaces:
    - SOURCE_NAMESPACE
  includedResources:
    - persistentvolumeclaims
    - persistentvolumes
  namespaceMapping:
    SOURCE_NAMESPACE: RECOVERY_NAMESPACE
  restorePVs: true
```

The restore namespace must not already hold `pgdata-CLUSTER-0`. Velero skips
an existing claim and still reports `Completed`, so the checks below would read
the older copy. This command must report `NotFound`:

```bash
kubectl -n RECOVERY_NAMESPACE get pvc pgdata-CLUSTER-0
```

To retire an earlier copy, delete its claim. Then destroy its `Released` volume
with [Reclaim a released volume](/how-to/reclaim-a-released-volume/).

Validate the Restore on the server, create it, and wait for phase `Completed`
with no errors:

```bash
kubectl apply --dry-run=server -f restore.yaml
kubectl create -f restore.yaml
kubectl -n velero get restore RESTORE_NAME \
  -o jsonpath='{.status.phase} errors={.status.errors} warnings={.status.warnings}{"\n"}'
```

Confirm that this Restore created the claim. The command must print
`RESTORE_NAME`:

```bash
kubectl -n RECOVERY_NAMESPACE get pvc pgdata-CLUSTER-0 \
  -o jsonpath='{.metadata.labels.velero\.io/restore-name}{"\n"}'
```

Confirm that the restored PV and its volume handle both differ from
production's. `CLUSTER` is the operator cluster name, such as
`delivery-postgresql`.

```bash
for ns in SOURCE_NAMESPACE RECOVERY_NAMESPACE; do
  pv="$(kubectl -n "$ns" get pvc "pgdata-CLUSTER-0" -o jsonpath='{.spec.volumeName}')"
  kubectl get pv "$pv" -o jsonpath='{.metadata.name} {.spec.csi.volumeHandle}{"\n"}'
done
```

Confirm that every stream in the volume's snapshot chain is `Done`.
`SOURCE_PV` is production's PV name from the previous output. Each ZFSBackup
is named `<source PV>.<backup name>`, and `PREVIOUS` names the snapshot it
builds on. The Velero server log shows each stream the Restore received.

```bash
kubectl -n openebs get zfsbackups.zfs.openebs.io \
  -o custom-columns='NAME:.metadata.name,PREVIOUS:.spec.prevSnapName,STATUS:.status' \
  | grep SOURCE_PV
kubectl -n velero logs deployment/velero | grep RESTORE_NAME
```

:::caution[Check the entire snapshot chain]
An incremental snapshot needs its full base. A restore that receives only a
volume, or reports `PartiallyFailed`, does not prove database recovery. Keep the
independent full backup and verified restore available throughout the upgrade.
:::

:::note[The Velero CLI writes to the cluster]
`velero backup describe --details`, `velero restore describe --details`, and
`velero backup logs` or `velero restore logs` each create a DownloadRequest in
namespace `velero`. A plain `describe` can create one too. To inspect without
writing, read the Restore, the ZFSBackups, and the server log as above.
:::

A failed or partial restore stays on the Ops maintenance list until you
classify it. When a later restore of the same backup completed and passed these
checks, record that on the failed Restore with two annotations:
`ops.sjer.red/restore-failure-classification=superseded-by-accepted-restore`
and `ops.sjer.red/superseded-by-restore=<completed restore name>`. Ops shows it
as information only while the named Restore exists in the same namespace, is
`Completed`, is newer, and has the same `spec.backupName`. Otherwise it stays a
warning that names the unmet condition. Setting either annotation without the
other fails the storage collection.

### Start PostgreSQL on the copy

Read production's image and preload list. The copy must run the same Spilo
image.

```bash
kubectl -n SOURCE_NAMESPACE get pod CLUSTER-0 \
  -o jsonpath='{.spec.containers[?(@.name=="postgres")].image}{"\n"}'
kubectl exec -n SOURCE_NAMESPACE CLUSTER-0 -c postgres -- \
  su postgres -c 'psql -XAt -c "SHOW shared_preload_libraries"'
```

Set `SPILO_IMAGE` to that image. Set `PRELOAD_LIBRARIES` to that list without
`bg_mon` and `pg_cron`. Create this Pod in the restore namespace:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: postgresql-verify
  namespace: RECOVERY_NAMESPACE
spec:
  automountServiceAccountToken: false
  enableServiceLinks: false
  restartPolicy: Never
  terminationGracePeriodSeconds: 330
  securityContext:
    runAsNonRoot: true
    runAsUser: 101
    runAsGroup: 103
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: postgres
      image: SPILO_IMAGE
      command: ["/bin/bash", "-c"]
      args:
        - |
          set -euo pipefail
          D=/home/postgres/pgdata/pgroot/data
          BIN="/usr/lib/postgresql/$(cat "$D/PG_VERSION")/bin"
          control() { "$BIN/pg_controldata" -D "$D" | grep -E "^(Database cluster state|Database system identifier|Data page checksum version)"; }
          echo "== controldata before start"; control
          stop() { "$BIN/pg_ctl" -D "$D" -m fast -w -t 300 stop || true; exit 143; }
          trap stop TERM INT
          "$BIN/pg_ctl" -D "$D" -w -t 900 start -o "-c listen_addresses='' -c unix_socket_directories=/tmp -c ssl=off -c archive_mode=off -c default_transaction_read_only=on -c logging_collector=off -c log_destination=stderr -c timescaledb.telemetry_level=off -c shared_preload_libraries=PRELOAD_LIBRARIES"
          while [ ! -f /tmp/stop ]; do sleep 2 & wait $!; done
          trap - TERM INT
          "$BIN/pg_ctl" -D "$D" -m fast -w -t 300 stop
          echo "== controldata after clean stop"; control
          echo "== pg_checksums"; "$BIN/pg_checksums" --check -D "$D"
      securityContext:
        allowPrivilegeEscalation: false
        capabilities:
          drop: ["ALL"]
      resources:
        requests:
          cpu: 100m
          memory: 512Mi
        limits:
          memory: 1Gi
      volumeMounts:
        - name: pgdata
          mountPath: /home/postgres/pgdata
  volumes:
    - name: pgdata
      persistentVolumeClaim:
        claimName: pgdata-CLUSTER-0
```

The Pod runs `pg_ctl` directly instead of Spilo's entrypoint, so Patroni never
starts. Each setting has one job:

| Setting                                                | Why                                                                                                                                                                                                 |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runAsUser: 101`, `runAsGroup: 103`                    | Spilo's [`postgres` user](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/postgres/temporal-db.ts) owns PGDATA. Restricted Pod Security rejects root. |
| No `fsGroup`                                           | Kubernetes would add group permissions to PGDATA recursively. PostgreSQL refuses a group-writable data directory.                                                                                   |
| `RuntimeDefault` seccomp, all capabilities dropped     | The restore namespace enforces the `restricted` Pod Security level.                                                                                                                                 |
| No service-account token or Service links              | The copy gets no Kubernetes credential and no Service addresses.                                                                                                                                    |
| `restartPolicy: Never`                                 | A failed start stays visible instead of retrying recovery on the copy.                                                                                                                              |
| `terminationGracePeriodSeconds: 330`                   | Deleting the Pod leaves time for the trap's clean stop, which waits up to 300 seconds.                                                                                                              |
| `listen_addresses=''`                                  | The server opens no TCP port. Only `kubectl exec` reaches it.                                                                                                                                       |
| `unix_socket_directories=/tmp`                         | Spilo's entrypoint prepares the configured socket directory, and this Pod skips the entrypoint.                                                                                                     |
| `ssl=off`                                              | The restored configuration names certificates that Spilo's entrypoint generates. They do not exist here.                                                                                            |
| `archive_mode=off`                                     | The copy archives no WAL.                                                                                                                                                                           |
| `default_transaction_read_only=on`                     | Checks cannot write to the copy by accident.                                                                                                                                                        |
| `logging_collector=off`, `log_destination=stderr`      | Recovery and shutdown appear in `kubectl logs`.                                                                                                                                                     |
| `timescaledb.telemetry_level=off`                      | TimescaleDB otherwise sends telemetry over the network.                                                                                                                                             |
| Preload list without `bg_mon` and `pg_cron`            | `bg_mon` opens an HTTP listener, and `pg_cron` runs scheduled jobs.                                                                                                                                 |
| Wait for `/tmp/stop`, then stop and run `pg_checksums` | `pg_checksums` needs a cleanly stopped cluster in the same container.                                                                                                                               |

Follow the log until it prints `server started`. Expect `pg_ctl` to warn that
another server might be running, because the snapshot holds production's
`postmaster.pid`. Crash recovery must end with `database system is ready to
accept connections`.

```bash
kubectl -n RECOVERY_NAMESPACE logs -f postgresql-verify
```

:::caution[The restore namespace's NetworkPolicy is not enforced]
The homelab CNI is Flannel without a NetworkPolicy controller
([agent task boundary](/explanation/temporal/agent-task-boundary/)). The
namespace's deny-all policy therefore blocks nothing. The copy stays offline
only because nothing in the Pod opens a connection.
:::

Confirm that the copy holds no TCP or UDP socket. The command must print
nothing. If it prints a socket, delete the Pod before running any check.

```bash
kubectl -n RECOVERY_NAMESPACE exec postgresql-verify -c postgres -- \
  sh -c 'cat /proc/net/tcp* /proc/net/udp* | grep -v local_address || true'
```

### Check the copy

Save these checks as `restore-checks.sql`. They read catalog views and row
counts, never row contents.

```sql
\pset footer off
\echo == server
SELECT current_setting('server_version') AS server_version,
       (SELECT system_identifier FROM pg_control_system()) AS system_identifier,
       current_setting('data_checksums') AS checksums,
       pg_is_in_recovery() AS in_recovery,
       current_setting('transaction_read_only') AS read_only,
       current_setting('listen_addresses') = '' AS no_tcp;
\echo == catalog
SELECT (SELECT count(*) FROM pg_class) AS relations,
       (SELECT count(*) FROM pg_index WHERE NOT indisvalid) AS invalid_indexes;
\echo == row counts
SELECT table_name,
       (xpath('/row/c/text()', query_to_xml(
         format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name),
         false, true, '')))[1]::text::bigint AS row_count
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY 1;
```

Run them on the copy. `DATABASE` is the application database, such as
`delivery_db`. Run the same file against production through a
[read-only session](/how-to/connect-to-a-homelab-database/#read-only-session).

```bash
kubectl exec -i -n RECOVERY_NAMESPACE postgresql-verify -c postgres -- \
  psql -X -h /tmp -U postgres -d DATABASE -v ON_ERROR_STOP=1 -f - \
  < restore-checks.sql
```

| Check      | Pass on the copy                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| Server     | Production's major version and system identifier. `checksums` `on`, `in_recovery` `f`, `read_only` `on`, `no_tcp` `t`.  |
| Catalog    | `invalid_indexes` is `0`.                                                                                               |
| Row counts | Every production table is present. Each count matches production's, or production wrote to that table after the backup. |

Treat any difference that post-backup writes do not explain as a failed
restore. Row counts show completeness, not content.

For Delivery's catalog, also save these checks as `delivery-checks.sql`. Run
them the same way against `delivery_db`.

```sql
\pset footer off
\echo == migrations
SELECT migration_name,
       finished_at IS NOT NULL AS finished,
       rolled_back_at IS NOT NULL AS rolled_back
FROM _prisma_migrations
ORDER BY started_at;
\echo == latest writes
SELECT (SELECT max("occurredAt") FROM "Audit") AS audit,
       (SELECT max("createdAt") FROM "Deployment") AS deployment,
       (SELECT max("createdAt") FROM "Outbox") AS outbox,
       (SELECT max("createdAt") FROM "Build") AS build,
       (SELECT max("createdAt") FROM "Artifact") AS artifact;
\echo == accepted set revisions without a succeeded deployment
SELECT e.id, e."acceptedVersionSetRevisionId"
FROM "Environment" e
WHERE e."acceptedVersionSetRevisionId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Deployment" d
    WHERE d."environmentId" = e.id
      AND d."versionSetRevisionId" = e."acceptedVersionSetRevisionId"
      AND d.status = 'succeeded'
      AND d.kind NOT IN ('adopt-worker', 'repair-trmnl')
      AND d."platformSnapshot" IS NULL
      AND d."controlPlaneSnapshot" IS NULL
  )
ORDER BY 1;
\echo == held work: active pointers, platform locks and unheld owners
SELECT 'active' AS holder, e.id AS scope, d.id AS deployment, d.status,
       d."recoveryRequired",
       d."environmentId" = e.id
         AND ((d.status = 'running' AND d."finishedAt" IS NULL
               AND NOT d."recoveryRequired")
           OR (d.status IN ('failed', 'canceled') AND d."finishedAt" IS NOT NULL
               AND d."recoveryRequired"))
         AND (EXISTS (SELECT 1 FROM "PlatformLock" p
                      WHERE p.id = 'shared-resources' AND p."deploymentId" = d.id)
           OR NOT (d.kind = 'upgrade-control-plane'
             OR (d."platformSnapshot" IS NOT NULL AND d.kind <> 'tofu-plan')))
         AS consistent
FROM "Environment" e
LEFT JOIN "Deployment" d ON d.id = e."activeDeploymentId"
WHERE e."activeDeploymentId" IS NOT NULL
UNION ALL
SELECT 'platform-lock', p.id, d.id, d.status, d."recoveryRequired",
       p.id = 'shared-resources'
FROM "PlatformLock" p
JOIN "Deployment" d ON d.id = p."deploymentId"
UNION ALL
SELECT 'unheld', d."environmentId", d.id, d.status, d."recoveryRequired", false
FROM "Deployment" d
WHERE (d.status = 'running' OR d."recoveryRequired")
  AND NOT EXISTS (
    SELECT 1 FROM "Environment" e
    WHERE e.id = d."environmentId" AND e."activeDeploymentId" = d.id
  )
ORDER BY 1, 2;
```

| Check            | Pass on the copy                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| Migrations       | The same migrations as production, each finished and none rolled back.                          |
| Latest writes    | Each timestamp matches production's. A newer production timestamp must postdate the backup.     |
| Accepted pointer | No rows. Every accepted set revision has a succeeded application Deployment in its environment. |
| Held work        | `consistent` is `t` on every row.                                                               |

The accepted-pointer check counts only application Deployments, as
`acceptedPointers` in the
[claim and release logic](https://github.com/shepherdjerred/monorepo/blob/main/packages/delivery/src/infrastructure/delivery-execution.ts)
does. Platform and control-plane Deployments carry a snapshot and move their
own pointers instead. Neither
[worker adoption](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/README.md#delivery-execution)
nor a
[TRMNL repair](https://github.com/shepherdjerred/monorepo/blob/main/packages/delivery/README.md)
moves an accepted pointer.

A Deployment takes its target lock and its environment's active pointer in the
same transaction that sets it `running`. A platform operation other than
`tofu-plan`, or a control-plane upgrade, also takes the shared
[platform lock](https://github.com/shepherdjerred/monorepo/blob/main/packages/delivery/src/infrastructure/platform/lifecycle.ts)
then. That lock's ID is always `shared-resources`. After it finishes, a
Deployment keeps its locks only when `recoveryRequired` holds the work in
quarantine
([claim and release logic](https://github.com/shepherdjerred/monorepo/blob/main/packages/delivery/src/infrastructure/delivery-execution.ts)).
Only a `failed` or `canceled` finish can require recovery
([finish validation](https://github.com/shepherdjerred/monorepo/blob/main/packages/delivery/src/infrastructure/delivery-records.ts)).
An active pointer is `consistent` when it names a Deployment of its own
environment that is either `running` without `recoveryRequired`, or `failed`
or `canceled` with it. That Deployment must also hold any platform lock it
needs. A platform lock is `consistent` when its ID is `shared-resources`. The
v1 lock check below validates its holder. A running or quarantined Deployment
that is not its environment's active one appears as `unheld` and is never
consistent. Each consistent row is running, quarantined or barrier-holding
work that the backup captured.
Reconcile every row with Temporal and native state before resuming
submissions.

The next three checks name v1-only schema, which Delivery's v2 schema removes,
so they fail there. Run them only against a v1 catalog. Each must return no
rows.

- The lock check reads `ApplicationLock` and `ContentRecoveryIntent`. It shows
  an active Deployment without the lock on its own target, or a target lock
  whose owner is not active. The claim derives the target from the pipeline:
  `static-site:<bucket>`, `tofu:<stack>`, or otherwise the environment's
  application. It also shows a platform lock without a valid holder. A valid
  holder is either a platform or control-plane operation that is its
  environment's active Deployment, or a
  [content recovery](https://github.com/shepherdjerred/monorepo/blob/main/packages/delivery/src/infrastructure/content-recovery/checkpoints.ts)
  whose producer barrier is still held. Content recovery
  [keeps the lock](https://github.com/shepherdjerred/monorepo/blob/main/packages/delivery/src/infrastructure/recovery-settlement.ts)
  after it settles and clears the active pointer, until its producer restarts.
  A held barrier is valid in only two states. An unfinished `pending` intent's
  owner is still active, `failed` or `canceled`, and requires recovery, and its
  environment is still at the intent's expected generation. A finished
  `succeeded` intent's owner is `failed` or `canceled` and no longer requires
  recovery. Its environment has no active Deployment and is one generation past
  the intent's expected generation. These are what
  [the pending checks](https://github.com/shepherdjerred/monorepo/blob/main/packages/delivery/src/infrastructure/content-recovery/context.ts)
  and
  [restoration](https://github.com/shepherdjerred/monorepo/blob/main/packages/delivery/src/infrastructure/content-recovery/restoration.ts)
  require. In the other direction, every held barrier must own the
  `shared-resources` lock, and at most one barrier may be held. Delivery takes
  and releases a barrier together with that lock, and a held barrier blocks
  every new claim.
- The specialized-pointer check reads `acceptedPlatformDeploymentId`,
  `acceptedControlPlaneDeploymentId` and `acceptedForumBaselineIntentId`. Each
  must name a succeeded record of its own environment, of the kind that
  `acceptedPointers` or forum baseline settlement would accept. A platform
  pointer's Deployment carries a platform snapshot of its own kind, and a
  control-plane pointer's carries a control-plane snapshot, because the
  consumers parse exactly those. An accepted forum baseline carries its proof.
  These checks confirm that each snapshot or proof is present. Delivery's own
  schemas validate the contents when they are read.
- The label check reads `configurationRevision` and `configuration` on
  `Environment` and `Deployment`. It shows a label that carries two contents.

```sql
SELECT 'active without target lock' AS problem, e.id AS scope,
       e."activeDeploymentId" AS deployment
FROM "Environment" e
LEFT JOIN "Deployment" d ON d.id = e."activeDeploymentId"
LEFT JOIN "Pipeline" pl ON pl.id = d."pipelineRevisionId"
WHERE e."activeDeploymentId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ApplicationLock" a
    WHERE a."deploymentId" = e."activeDeploymentId"
      AND a.application = CASE pl.definition->>'kind'
        WHEN 'static-site' THEN 'static-site:' || (pl.definition->>'bucket')
        WHEN 'tofu' THEN 'tofu:' || (pl.definition->>'stack')
        ELSE e.application
      END
  )
UNION ALL
SELECT 'target lock without active owner', a.application, a."deploymentId"
FROM "ApplicationLock" a
WHERE NOT EXISTS (
  SELECT 1 FROM "Environment" e WHERE e."activeDeploymentId" = a."deploymentId"
)
UNION ALL
SELECT 'platform lock without valid holder', p.id, p."deploymentId"
FROM "PlatformLock" p
JOIN "Deployment" d ON d.id = p."deploymentId"
WHERE NOT (
  p.id = 'shared-resources'
  AND (
    ((d.kind = 'upgrade-control-plane'
        OR (d."platformSnapshot" IS NOT NULL AND d.kind <> 'tofu-plan'))
      AND EXISTS (
        SELECT 1 FROM "Environment" e
        WHERE e.id = d."environmentId" AND e."activeDeploymentId" = d.id
      ))
    OR EXISTS (
      SELECT 1 FROM "ContentRecoveryIntent" i
      JOIN "Environment" e ON e.id = d."environmentId"
      WHERE i."deploymentId" = d.id
        AND i."dispatchBarrier" IS NOT NULL AND i."barrierRestoredAt" IS NULL
        AND d.status IN ('failed', 'canceled')
        AND ((i.status = 'pending' AND i."finishedAt" IS NULL
              AND d."recoveryRequired"
              AND e."activeDeploymentId" = d.id
              AND e.generation = i."expectedEnvironmentGeneration")
          OR (i.status = 'succeeded' AND i."finishedAt" IS NOT NULL
              AND NOT d."recoveryRequired"
              AND e."activeDeploymentId" IS NULL
              AND e.generation = i."expectedEnvironmentGeneration" + 1))
    )
  )
)
UNION ALL
SELECT 'held barrier without platform lock', i.id, i."deploymentId"
FROM "ContentRecoveryIntent" i
WHERE i."dispatchBarrier" IS NOT NULL AND i."barrierRestoredAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "PlatformLock" p
    WHERE p.id = 'shared-resources' AND p."deploymentId" = i."deploymentId"
  )
UNION ALL
SELECT 'more than one held barrier', i.id, i."deploymentId"
FROM "ContentRecoveryIntent" i
WHERE i."dispatchBarrier" IS NOT NULL AND i."barrierRestoredAt" IS NULL
  AND (SELECT count(*) FROM "ContentRecoveryIntent" o
       WHERE o."dispatchBarrier" IS NOT NULL AND o."barrierRestoredAt" IS NULL) > 1
ORDER BY 1, 2;
SELECT 'platform' AS pointer, e.id AS environment,
       e."acceptedPlatformDeploymentId" AS record
FROM "Environment" e
WHERE e."acceptedPlatformDeploymentId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Deployment" d
    WHERE d.id = e."acceptedPlatformDeploymentId" AND d."environmentId" = e.id
      AND d.status = 'succeeded' AND d.kind IN ('root-release', 'tofu-apply')
      AND d."platformSnapshot"->>'kind' = d.kind
  )
UNION ALL
SELECT 'control-plane', e.id, e."acceptedControlPlaneDeploymentId"
FROM "Environment" e
WHERE e."acceptedControlPlaneDeploymentId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Deployment" d
    WHERE d.id = e."acceptedControlPlaneDeploymentId" AND d."environmentId" = e.id
      AND d.status = 'succeeded' AND d.kind = 'upgrade-control-plane'
      AND d."controlPlaneSnapshot" IS NOT NULL
  )
UNION ALL
SELECT 'forum-baseline', e.id, e."acceptedForumBaselineIntentId"
FROM "Environment" e
WHERE e."acceptedForumBaselineIntentId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ForumBaselineIntent" f
    WHERE f.id = e."acceptedForumBaselineIntentId" AND f."environmentId" = e.id
      AND f.status = 'succeeded' AND f."finishedAt" IS NOT NULL
      AND f.proof IS NOT NULL
  )
ORDER BY 1, 2;
SELECT label, count(DISTINCT content) AS contents
FROM (
  SELECT "configurationRevision" AS label, configuration AS content FROM "Environment"
  UNION ALL
  SELECT "configurationRevision", configuration FROM "Deployment"
) labels
GROUP BY label
HAVING count(DISTINCT content) > 1
ORDER BY 1;
```

### Stop the copy and check its pages

Signal the clean stop, then follow the log to the checksum result:

```bash
kubectl exec -n RECOVERY_NAMESPACE postgresql-verify -c postgres -- touch /tmp/stop
kubectl -n RECOVERY_NAMESPACE logs -f postgresql-verify
```

The log must show `Database cluster state: shut down` and `Bad checksums: 0`.
Delete the Pod afterwards. Keep the restored PVC and PV until a later restore
retires them.

### Check upgrade compatibility

Run [`pg_upgrade --check`](https://www.postgresql.org/docs/18/pgupgrade.html)
with both server toolchains and a separately initialized target directory.
Use the same Spilo image as the intended live upgrade. Fix any extension or
compatibility error before proceeding.

Initialize the target with the restored cluster's locale and checksum setting.
Pass production's `shared_preload_libraries` through `--new-options` when
checking the target. Extensions such as `pg_stat_kcache` require loading at
startup. Keep the temporary server's TCP listener disabled.

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

For an application using a dedicated non-superuser database role, record its
current connection limit, set `ALTER ROLE <role> CONNECTION LIMIT 0`, and
terminate that role's existing sessions. Verify that no application sessions or
prepared transactions remain, then issue `CHECKPOINT` before the final backup.
Keep the limit at zero throughout the upgrade. This blocks new application
connections during maintenance; it does not restrict superusers or background
workers. Restore the exact original limit after the database checks pass, then
verify the application's read/write flow. Retain the recorded limit for recovery
if the upgrade fails.

After the writer-quiescence checks and `CHECKPOINT`, take the final consistent
independent backup. Confirm the pod's `PGVERSION` matches the new source pin and
that both toolchains are present.

For a single-member cluster, invoke the Spilo entrypoint as the PostgreSQL
operating-system user. The container defaults to root, which `initdb` rejects.

```bash
kubectl exec -n temporal temporal-postgresql-0 -c postgres -- \
  su postgres -c 'python3 /scripts/inplace_upgrade.py 1'
```

Wait for the entrypoint to finish its statistics rebuild and post-bootstrap
steps. It recreates monitoring extensions during post-bootstrap.

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
