---
title: Upgrade the Temporal server
description: Stage a schema-first Temporal server upgrade, prove the database backup and TLS gates, and roll back the binary safely.
sidebar:
  order: 6
---

Temporal server releases are sequential production changes. Never combine two
server versions into one rollout: deploy one version, collect runtime
acceptance, and only then prepare the next pull request.

## Before the first schema-managed release

Deploy the PostgreSQL certificate change by itself. Wait for the
`temporal-postgresql` Certificate to become Ready and for the single PostgreSQL
pod to complete its rolling restart.

```sh
kubectl --namespace temporal wait \
  --for=condition=Ready certificate/temporal-postgresql \
  --timeout=5m

kubectl --namespace temporal get certificate temporal-postgresql
kubectl --namespace temporal rollout status statefulset/temporal-postgresql
```

Read the live certificate from the Secret and verify that its subject
alternative names cover both the service and pod endpoints. Do not print the
private key.

```sh
kubectl --namespace temporal get secret temporal-postgresql-tls \
  --output jsonpath='{.data.tls\.crt}' |
  base64 --decode |
  openssl x509 -noout -subject -issuer -dates -ext subjectAltName
```

The service name
`temporal-postgresql.temporal.svc.cluster.local` and the pod name
`temporal-postgresql-0.temporal-postgresql.temporal.svc.cluster.local` must
both appear.

## Deploy one server version

Confirm the pull request pins `temporalio/server` and
`temporalio/admin-tools` to the same release. The first migration is 1.30.6.
The 1.31.2 change is a separate future release and must not merge until the
1.30.6 acceptance below is recorded.

Argo runs two ordered gates before touching the server Deployment:

1. `temporal-backup-preflight`, a PreSync hook, requires the newest
   `6hourly-backup` to be less than seven hours old, completed without errors,
   and to have completed every attempted volume snapshot. It then proves that
   backup covered the PostgreSQL volume specifically, by reading the
   `ZFSBackup` object openebs zfs-localpv writes for the PVC's bound PV under
   that backup's name and requiring status `Done`.
2. `temporal-schema-migration`, a Sync hook at wave -1, runs the matching
   admin-tools image and updates both the core and visibility PostgreSQL
   schemas over verified TLS.

A failed hook fails the Argo sync, so the old server stays running. Do not skip
or delete a failed hook to force the rollout. Repair the backup, certificate,
database, or schema problem and retry the same release.

The temporal child sync waits up to 20 minutes because the migration hook may
run up to 15 minutes: DDL that rewrites a hot table runs under live server
traffic. The visibility v1.14 migration (two `STORED` generated columns on a
6 GiB `executions_visibility`) needed most of that budget across two attempts.
The waiter must outlast the hook, so both numbers live together in
`temporal-release-budgets.ts`, which the chart and the release script share.

If a sync times out mid-migration, check whether the DDL landed before the
version marker:

```sh
kubectl --namespace temporal exec temporal-postgresql-0 -- \
  psql -U postgres -d temporal_visibility -c "SELECT * FROM schema_version;"
kubectl --namespace temporal exec temporal-postgresql-0 -- \
  psql -U postgres -d temporal_visibility -c "\d executions_visibility"
```

`temporal-sql-tool` tolerates already-applied statements
(`Duplicate update ... Ignoring it and continue`), so retrying the same
release resumes a partially applied migration instead of restarting it: the
landed statements are skipped as duplicates and only the pending work remains.

Watch the gates and the Deployment:

```sh
kubectl --namespace temporal get jobs,pods --watch
kubectl --namespace temporal logs job/temporal-backup-preflight
kubectl --namespace temporal logs job/temporal-schema-migration
kubectl --namespace temporal rollout status deployment/temporal-temporal-server
```

Successful hooks are deleted after completion. Read their logs while the sync
is running or use Loki afterward.

## Prove runtime acceptance

Check the native server surfaces before considering the release complete:

```sh
toolkit temporal operator cluster health
toolkit temporal operator namespace describe --namespace beta
toolkit temporal operator namespace describe --namespace prod
toolkit temporal --namespace prod schedule list
toolkit temporal --namespace prod workflow list --query "ExecutionStatus='Running'"
```

Then verify all of the following:

- namespace retention remains 720 hours;
- schedules retain their paused state and next-action times;
- every expected workflow and Activity task queue has a poller;
- one central canary and one Scout beta canary complete;
- no Temporal server, workflow-task, nondeterminism, retry-exhaustion, or
  poller alerts are active;
- server and workflow-task error rates remain at their pre-release baseline;
- PostgreSQL connections show certificate verification failures neither in
  the server logs nor in Loki.

Record the deployed server digest, both schema-hook results, canary execution
IDs, alert state, and the acceptance window on the pull request or its Linear
issue. Do not create a repository-local rollout journal.

## Roll back the server binary

Do not roll a database schema backward. Temporal supports deploying the older
server binary against the already-upgraded schema during rollback.

Revert only the server image pin to the last accepted release, keep the newer
schema in place, and run the same backup and schema hooks. The schema update is
idempotent and should report no pending migrations. After the old Deployment
is healthy, repeat the runtime acceptance checks above.

If the database or its certificate is unhealthy, stop. A server-image rollback
does not repair persistence and must not be used to bypass a failed backup or
TLS gate.

## Advance to the next release

Prepare 1.31.2 only after 1.30.6 has passed runtime acceptance. Update the
server and admin-tools pins together, obtain another current successful Velero
backup, and repeat the complete procedure. Never stack the unverified second
upgrade on the first release branch.

## Related

- [Why Temporal](/explanation/temporal/overview/)
- [Pause or debug a schedule](/how-to/pause-or-debug-a-schedule/)
- [Temporal schedule mechanics](/reference/temporal-schedules/)
