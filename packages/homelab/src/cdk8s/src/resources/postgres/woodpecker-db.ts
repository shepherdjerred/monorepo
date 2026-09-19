import type { Chart } from "cdk8s";
import {
  Postgresql,
  PostgresqlSpecPostgresqlVersion,
  PostgresqlSpecUsers,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/acid.zalan.do";

/**
 * Backing store for the Woodpecker CI server.
 *
 * Woodpecker keeps pipeline history, step logs, repo registrations, and forge
 * OAuth sessions here. Losing it does not lose any build input — those live in
 * Git and the registries — but it does lose the record of what ran, which the
 * release lanes read back when deciding the last green main commit. It is
 * therefore backed up, unlike the CI caches in this namespace.
 *
 * The operator generates the password and publishes it as
 * `woodpecker.woodpecker-postgresql.credentials.postgresql.acid.zalan.do`.
 */
export function createWoodpeckerPostgreSQLDatabase(chart: Chart) {
  return new Postgresql(chart, "woodpecker-postgresql", {
    metadata: {
      name: "woodpecker-postgresql",
      labels: {
        // Velero selects PVCs to back up by this label. The postgres-operator
        // copies it onto the pgdata PVC via inherited_labels.
        "velero.io/backup": "enabled",
        "velero.io/exclude-from-backup": "false",
      },
      annotations: {
        // Prevent ArgoCD from deleting this resource during sync - data loss protection
        "argocd.argoproj.io/sync-options": "Delete=false",
      },
    },
    spec: {
      numberOfInstances: 1,
      teamId: "homelab",
      postgresql: {
        version: PostgresqlSpecPostgresqlVersion.VALUE_16,
        parameters: {
          // Woodpecker's write pattern is step-log append plus small pipeline
          // row updates, with one connection per in-flight workflow and a
          // handful for the web UI. Sized against WOODPECKER_MAX_WORKFLOWS
          // rather than a general-purpose profile.
          max_connections: "100",
          shared_buffers: "128MB",
          effective_cache_size: "512MB",
          maintenance_work_mem: "32MB",
          checkpoint_completion_target: "0.9",
          wal_buffers: "8MB",
          default_statistics_target: "100",
          random_page_cost: "1.1",
          effective_io_concurrency: "200",
          work_mem: "4MB",
          min_wal_size: "128MB",
          max_wal_size: "2GB",
          log_statement: "none",
          log_min_duration_statement: "1000",
          // Must match pg_hba auth method — prevents hash format mismatch after cluster restore
          password_encryption: "scram-sha-256",
        },
      },
      volume: {
        // Sized the way bugsink-db.ts documents: the live database is small,
        // but Postgres block churn inflates the retained Velero ZFS snapshots
        // far beyond it. Step logs make Woodpecker churn harder than Bugsink,
        // so do not shrink this without checking snapshot usage first.
        size: "32Gi",
        storageClass: "zfs-ssd",
      },
      users: {
        woodpecker: [PostgresqlSpecUsers.CREATEDB],
      },
      databases: {
        woodpecker_db: "woodpecker",
      },
      resources: {
        requests: {
          cpu: "50m",
          memory: "128Mi",
        },
        limits: {
          cpu: "500m",
          memory: "1Gi",
        },
      },
      patroni: {
        initdb: {
          encoding: "utf8",
          locale: "en_US.utf8",
          "data-checksums": "true",
        },
        pgHba: [
          // Local connections for postgres superuser (required for Patroni management)
          "local all postgres peer",
          "local all all peer",
          // Use SCRAM-SHA-256 authentication for remote connections
          "hostssl all postgres all scram-sha-256",
          "hostssl woodpecker_db woodpecker all scram-sha-256",
          "hostssl replication standby all scram-sha-256",
          "host all postgres all scram-sha-256",
          "host woodpecker_db woodpecker all scram-sha-256",
          "host replication standby all scram-sha-256",
        ],
        slots: {},
      },
      enableShmVolume: true,
    },
  });
}
