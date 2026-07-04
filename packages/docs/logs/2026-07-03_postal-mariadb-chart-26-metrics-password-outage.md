# Postal outage — MariaDB chart v26 requires `mariadb-metrics-password`

## Status

Complete

## Symptom

Postal is down. In the `postal` namespace:

- `postal-mariadb-0` stuck `Init:0/1` — volumes never mount.
- `postal-postal-web` and `postal-postal-worker` crash-looping in `Error` — their init step
  (`rake db:create`) can't connect to MariaDB.
- `postal-postal-smtp` running (doesn't need the DB to start).

## Root cause

PR #1377 (`8025054fc`, merged 2026-07-03 12:05 PT, "bump all Helm charts & Docker images to
latest (incl. majors)") bumped the Bitnami MariaDB chart **25.1.2 → 26.1.7** (major). In chart
v26, when `metrics.enabled: true` and `auth.existingSecret` are combined, the chart:

1. Projects a new key from the existing secret into the credentials volume:
   `mariadb-metrics-password` (used by a dedicated low-privilege `exporter` MariaDB user).
2. Adds a `postal-mariadb-metrics-init` initdb script that creates the `exporter` user —
   but initdb scripts only run on a **fresh** data dir, so they never run for our existing DB.

Our 1Password item (`zlz4hlpcgk74nhqysgrre5wv4i` → `postal-mariadb-credentials`) only has
`mariadb-root-password` and `mariadb-password`. Kubelet fails the secret volume mount:

```
MountVolume.SetUp failed for volume "mariadb-credentials" : references non-existent secret key: mariadb-metrics-password
```

The pod can never start, so MariaDB is down, so Postal web/worker crash. Outage began at the
ArgoCD sync ~12:20 PT (the smtp pod's original start time, ~7h before investigation).

Why the 1Password linter didn't catch it: the missing key is consumed by the **upstream Helm
chart's** rendered manifests (via ArgoCD), not by any cdk8s-synthesized `secretKeyRef`, so
`check-1password-items.ts` has no reference to validate.

## Red herrings

- `driver name zfs.csi.openebs.io not found in the list of registered CSI drivers` — transient;
  the node (`torvalds`) rebooted at 2026-07-04T02:21Z (~19:21 PT) and the ZFS CSI node plugin
  registered a few minutes after kubelet started scheduling. Not the blocker.
- `bitnami/mariadb:latest` image tag — pre-existing (previous StatefulSet revision also used
  `latest`); not introduced by this bump, though it remains a data-upgrade risk worth its own
  follow-up.

## Fix (recommended)

1. Add a `mariadb-metrics-password` field (generated password) to the 1Password item
   `zlz4hlpcgk74nhqysgrre5wv4i` in the homelab vault.
2. Refresh the vault snapshot: `cd packages/homelab/src/cdk8s && bun run scripts/snapshot-1password-vault.ts`, commit.
3. Wait for the 1Password operator to resync `postal-mariadb-credentials`; MariaDB then mounts
   and starts, and Postal web/worker recover on their next restart.
4. One-time manual step (initdb scripts don't run on existing data): create the exporter user —
   run the SQL from the `postal-mariadb-metrics-init` ConfigMap (`CREATE USER IF NOT EXISTS
'exporter'@'localhost' IDENTIFIED BY '<metrics password>'; GRANT PROCESS, REPLICATION CLIENT,
SLAVE MONITOR ON *.*; GRANT SELECT ON performance_schema.*`) inside `postal-mariadb-0`.
   Otherwise the metrics sidecar auth-fails (MariaDB itself is fine).
5. Cleanup in `packages/homelab/src/cdk8s/src/resources/postgres/postal-mariadb.ts`: the
   `metrics.extraEnvVars` override pointing the exporter at `mariadb-root-password` is an
   obsolete workaround from the pre-v26 chart — remove it, and update the doc comments listing
   the expected secret fields.

## Session Log — 2026-07-03

### Done

- Diagnosed the Postal outage end-to-end (namespace pod states, kubelet mount events, secret
  keys, StatefulSet spec, controller revisions, chart bump git history, metrics-init ConfigMap).
- Root cause: MariaDB chart 25→26 major bump in PR #1377 requires a `mariadb-metrics-password`
  key in `auth.existingSecret` when metrics are enabled; the 1Password item lacked it.
- Added a generated `mariadb-metrics-password` field to 1Password item
  `zlz4hlpcgk74nhqysgrre5wv4i`; the operator (60s poll) synced `postal-mariadb-credentials`,
  the mount succeeded, MariaDB started, and Postal web/worker recovered on their own.
- Created the `exporter` MariaDB user by exec'ing the chart's own script
  (`/docker-entrypoint-initdb.d/metrics/create_exporter_user.sh`), **plus** `'exporter'@'::1'`
  and `'exporter'@'127.0.0.1'` host variants — the exporter connects over TCP from `::1`, which
  does NOT match the `'exporter'@'localhost'` grant the upstream script creates. Verified
  `mysql_up 1` on the exporter's `/metrics`.
- Cleaned up `packages/homelab/src/cdk8s/src/resources/postgres/postal-mariadb.ts`: removed the
  obsolete pre-v26 `metrics.extraEnvVars` root-password workaround; updated the expected-fields
  doc comments.

### Remaining

- Refresh the 1Password vault snapshot (`bun run scripts/snapshot-1password-vault.ts` in
  `packages/homelab/src/cdk8s`) and commit it — two attempts hit `op` biometric authorization
  timeouts; needs the user present to approve.
- Open the PR from `fix/postal-mariadb-metrics-password` once the snapshot lands.

### Caveats

- The node rebooted during the investigation window; CSI errors in events are transient noise.
- The exporter user creation is manual, one-time state in the DB: it is NOT reproduced by a
  restore-from-scratch (initdb scripts only run on empty data dirs) and would need re-running
  after a data-dir rebuild. The upstream chart's `'exporter'@'localhost'`-only grant also looks
  broken for TCP connections even on fresh installs — worth watching after future chart bumps.
- `bitnami/mariadb:latest` (unpinned image tag, pre-existing) remains a data-upgrade risk,
  separate follow-up.
