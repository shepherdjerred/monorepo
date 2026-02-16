import { Chart } from "cdk8s";
import {
  Postgresql,
  PostgresqlSpecPostgresqlVersion,
  PostgresqlSpecUsers,
} from "../../../generated/imports/acid.zalan.do";

export function createBugsinkPostgreSQLDatabase(chart: Chart) {
  // The postgres-operator will automatically generate passwords and store them
  // in Kubernetes secrets with the naming pattern:
  // {username}.{clustername}.credentials.postgresql.acid.zalan.do

  // Create a PostgreSQL cluster specifically for Bugsink using the Zalando postgres-operator CRD
  return new Postgresql(chart, "bugsink-postgresql", {
    metadata: {
      name: "bugsink-postgresql",
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
          // PostgreSQL configuration optimized for Bugsink error tracking
          // Bugsink stores error events, stack traces, and metadata
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
          min_wal_size: "512MB",
          max_wal_size: "2GB",
          log_statement: "none",
          log_min_duration_statement: "1000",
        },
      },
      volume: {
        size: "8Gi", // Sufficient for homelab error volume
        storageClass: "zfs-ssd",
      },
      users: {
        bugsink: [PostgresqlSpecUsers.CREATEDB],
      },
      databases: {
        bugsink_db: "bugsink",
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
          encoding: "UTF8",
          locale: "en_US.utf8",
          "data-checksums": "true",
        },
        pgHba: [
          // Local connections for postgres superuser (required for Patroni management)
          "local all postgres peer",
          "local all all peer",
          // Use SCRAM-SHA-256 authentication for remote connections
          "hostssl all postgres all scram-sha-256",
          "hostssl bugsink_db bugsink all scram-sha-256",
          "hostssl replication standby all scram-sha-256",
          "host all postgres all scram-sha-256",
          "host bugsink_db bugsink all scram-sha-256",
          "host replication standby all scram-sha-256",
        ],
        slots: {},
      },
      // Enable TLS for PostgreSQL connections
      enableShmVolume: true,
    },
  });
}
