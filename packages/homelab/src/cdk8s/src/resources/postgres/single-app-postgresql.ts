import type { Chart } from "cdk8s";
import {
  Postgresql,
  PostgresqlSpecPostgresqlVersion,
  type PostgresqlSpecUsers,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/acid.zalan.do";

type SingleAppPostgreSQLOptions = {
  /** Cluster `<app>-postgresql`, owner role `<app>`, database `<app>_db`. */
  app: string;
  userFlags: PostgresqlSpecUsers[];
};

/**
 * A single-instance Zalando postgres-operator cluster owned by one app, with
 * Velero backup and ArgoCD delete protection.
 *
 * The operator generates the owner's password into the Secret
 * `<app>.<app>-postgresql.credentials.postgresql.acid.zalan.do`
 * (keys `username`, `password`).
 */
export function createSingleAppPostgreSQL(
  chart: Chart,
  { app, userFlags }: SingleAppPostgreSQLOptions,
) {
  const database = `${app}_db`;
  return new Postgresql(chart, `${app}-postgresql`, {
    metadata: {
      name: `${app}-postgresql`,
      labels: {
        // Velero selects PVCs to back up by this label. The postgres-operator copies
        // it onto the pgdata PVC via inherited_labels (postgres-operator.ts); this
        // replaces the removed Kyverno velero-label mutation.
        "velero.io/backup": "enabled",
        "velero.io/exclude-from-backup": "false",
      },
      annotations: {
        // Prevent ArgoCD from deleting this resource during sync - data loss protection
        "argocd.argoproj.io/sync-options": "Delete=false",
      },
    },
    spec: {
      numberOfInstances: 1, // Single node setup for homelab
      teamId: "homelab",
      postgresql: {
        version: PostgresqlSpecPostgresqlVersion.VALUE_16,
        parameters: {
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
        // 32Gi: Postgres block churn makes the retained Velero ZFS snapshots
        // (~26/dataset) balloon well past the live data. An 8Gi volume filled
        // to 0B (snapshots + data) and wedged writes (bugsink, 2026-05).
        size: "32Gi",
        storageClass: "zfs-ssd",
      },
      users: {
        [app]: userFlags,
      },
      databases: {
        [database]: app,
      },
      resources: {
        requests: {
          cpu: "50m",
          memory: "128Mi",
        },
        limits: {
          cpu: "250m",
          memory: "512Mi",
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
          `hostssl ${database} ${app} all scram-sha-256`,
          "hostssl replication standby all scram-sha-256",
          "host all postgres all scram-sha-256",
          `host ${database} ${app} all scram-sha-256`,
          "host replication standby all scram-sha-256",
        ],
        slots: {},
      },
      // Enable TLS for PostgreSQL connections
      enableShmVolume: true,
    },
  });
}
