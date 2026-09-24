import type { Chart } from "cdk8s";
import {
  Postgresql,
  PostgresqlSpecPostgresqlVersion,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/acid.zalan.do";

export function createPhoenixPostgreSQLDatabase(chart: Chart) {
  // The postgres-operator will automatically generate passwords and store them
  // in Kubernetes secrets with the naming pattern:
  // {username}.{clustername}.credentials.postgresql.acid.zalan.do

  // Dedicated PostgreSQL cluster for the Phoenix LLM trace store (Zalando
  // postgres-operator CRD). Phoenix runs its own Alembic migrations on boot.
  return new Postgresql(chart, "phoenix-postgresql", {
    metadata: {
      name: "phoenix-postgresql",
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
          // Phoenix stores tail-sampled LLM traces: span rows with large JSON
          // prompt/response attributes, pruned by the 30-day retention policy.
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
        // 32Gi: ~50MB/day of sampled traces x 30-day retention is ~1.5Gi of
        // live data, but retention deletes churn blocks that the retained
        // Velero ZFS snapshots keep alive (Bugsink's 8Gi volume filled to 0B
        // that way). Phoenix blocks inserts well before this fills; see
        // PHOENIX_DATABASE_ALLOCATED_STORAGE_CAPACITY_GIBIBYTES.
        size: "32Gi",
        storageClass: "zfs-ssd",
      },
      users: {
        phoenix: [],
      },
      databases: {
        phoenix_db: "phoenix",
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
          "hostssl phoenix_db phoenix all scram-sha-256",
          "hostssl replication standby all scram-sha-256",
          "host all postgres all scram-sha-256",
          "host phoenix_db phoenix all scram-sha-256",
          "host replication standby all scram-sha-256",
        ],
        slots: {},
      },
      // Enable TLS for PostgreSQL connections
      enableShmVolume: true,
    },
  });
}
