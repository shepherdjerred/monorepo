import type { Chart } from "cdk8s";
import {
  Postgresql,
  PostgresqlSpecPostgresqlVersion,
  PostgresqlSpecUsers,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/acid.zalan.do";

export function createTemporalPostgreSQLDatabase(chart: Chart) {
  // The postgres-operator will automatically generate passwords and store them
  // in Kubernetes secrets with the naming pattern:
  // {username}.{clustername}.credentials.postgresql.acid.zalan.do

  return new Postgresql(chart, "temporal-postgresql", {
    metadata: {
      name: "temporal-postgresql",
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
          // Keep pg_hba auth and generated role password hashes aligned.
          password_encryption: "scram-sha-256",
        },
      },
      volume: {
        size: "16Gi",
        storageClass: "zfs-ssd",
      },
      users: {
        temporal: [PostgresqlSpecUsers.CREATEDB],
      },
      databases: {
        temporal: "temporal",
        temporal_visibility: "temporal",
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
          "hostssl postgres postgres all md5",
          "hostssl postgres temporal all scram-sha-256",
          "hostssl temporal temporal all scram-sha-256",
          "hostssl temporal_visibility temporal all scram-sha-256",
          "hostssl replication standby all scram-sha-256",
          "local all all trust",
        ],
        slots: {},
      },
    },
  });
}
