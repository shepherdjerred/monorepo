---
title: Connect to a homelab database
description: Open a psql session against any of the homelab's PostgreSQL clusters, either inside the pod or through a port-forward.
sidebar:
  order: 12
---

Connect through the Kubernetes API, either with `psql` inside a database pod or
with a service port-forward. The Zalando
[postgres-operator](https://github.com/zalando/postgres-operator) manages the
clusters; they have no public database ingress.

## The clusters

| Cluster                 | Namespace    | User         | Databases                         |
| ----------------------- | ------------ | ------------ | --------------------------------- |
| `bugsink-postgresql`    | `bugsink`    | `bugsink`    | `bugsink_db`                      |
| `grafana-postgresql`    | `prometheus` | `grafana`    | `grafana`                         |
| `phoenix-postgresql`    | `phoenix`    | `phoenix`    | `phoenix_db`                      |
| `scout-beta-postgresql` | `scout-beta` | `scout`      | `scout`                           |
| `scout-prod-postgresql` | `scout-prod` | `scout`      | `scout`                           |
| `temporal-postgresql`   | `temporal`   | `temporal`   | `temporal`, `temporal_visibility` |
| `woodpecker-postgresql` | `woodpecker` | `woodpecker` | `woodpecker_db`                   |

They are defined in
[`packages/homelab/src/cdk8s/src/resources/postgres/`](https://github.com/shepherdjerred/monorepo/tree/main/packages/homelab/src/cdk8s/src/resources/postgres).
Each is a single instance with a node-local ZFS volume. Read the running server
version before selecting a dump or restore client.

:::caution[Every command needs an explicit namespace]
No database lives in namespace `default`. Always pass `-n`; do not depend on
the current context's namespace.
:::

## Find the credentials

The operator generates one Kubernetes Secret per user, named
`{username}.{clustername}.credentials.postgresql.acid.zalan.do`, holding
`username` and `password` keys. Alongside each application user you will also see
`postgres.` (superuser) and `standby.` secrets for the same cluster.

```bash
kubectl get secret -n temporal \
  temporal.temporal-postgresql.credentials.postgresql.acid.zalan.do \
  -o name
```

This confirms the Secret exists without printing its values. Supply passwords
directly to the client environment, as in the port-forward example below.

## Option 1 — psql inside the pod

The quickest path, and the one that needs nothing installed locally. Every
cluster is a single instance, so the master pod is always `<cluster>-0` and the
container is `postgres`. Connecting as the `postgres` superuser inside the pod
needs no password when the process runs as the container's `postgres` user.

```bash
kubectl exec -n temporal -it temporal-postgresql-0 -c postgres -- \
  su postgres -c 'psql -U postgres temporal'
```

If you would rather not assume the pod name, select it by label:

```bash
kubectl get pod -n temporal \
  -l application=spilo,cluster-name=temporal-postgresql,spilo-role=master
```

## Option 2 — port-forward and use a local client

Better when you want completion, syntax highlighting, or to point a GUI at the
database. `pgcli` and `psql` are both installed by the
[dotfiles Brewfile](https://github.com/shepherdjerred/monorepo/blob/main/packages/dotfiles/.Brewfile_darwin);
`psql` arrives via the keg-only `libpq`, which the shell config puts on `PATH`.

```bash
kubectl port-forward -n temporal svc/temporal-postgresql 15432:5432 &

PGPASSWORD="$(kubectl get secret -n temporal \
  temporal.temporal-postgresql.credentials.postgresql.acid.zalan.do \
  -o jsonpath='{.data.password}' | base64 -d)" \
  pgcli -h 127.0.0.1 -p 15432 -U temporal temporal
```

Use a high local port such as `15432` rather than `5432`, matching the
convention used elsewhere in the repo, so the forward never collides with a
local PostgreSQL install.

:::note[postal-mariadb is not PostgreSQL]
[`resources/postgres/postal-mariadb.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/postgres/postal-mariadb.ts)
lives in the same directory but deploys **MariaDB** in namespace `postal`. It
needs a MySQL client, and its credentials come from 1Password
(`postal-mariadb-credentials`) rather than from an operator-generated secret.
Reach it with `kubectl exec -n postal -it postal-mariadb-0 -- mariadb -u postal -p`.
:::

## Related

- [Pull a Scout database into local dev](/how-to/pull-a-scout-database-into-local-dev/)
- [Cut a homelab release](/how-to/cut-a-homelab-release/)
- [Pause or debug a schedule](/how-to/pause-or-debug-a-schedule/)
- [Temporal PostgreSQL's TLS identity](/explanation/temporal/postgresql-tls-identity/)
- [Upgrade a homelab PostgreSQL major version](/how-to/upgrade-a-homelab-postgresql-major-version/)
