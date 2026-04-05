import type { Chart } from "cdk8s";
import {
  Postgresql,
  PostgresqlSpecPostgresqlVersion,
  PostgresqlSpecUsers,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/acid.zalan.do";

export function createWindmillPostgreSQLDatabase(chart: Chart) {
  // The postgres-operator will automatically generate passwords and store them
  // in Kubernetes secrets with the naming pattern:
  // {username}.{clustername}.credentials.postgresql.acid.zalan.do

  return new Postgresql(chart, "windmill-postgresql", {
    metadata: {
      name: "windmill-postgresql",
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
          // Windmill stores job queue, scripts, flows, apps, and audit logs in PostgreSQL
          // Needs 50 connections per server + 5 per worker (60 total for our config)
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
          password_encryption: "scram-sha-256",
        },
      },
      volume: {
        size: "8Gi",
        storageClass: "zfs-ssd",
      },
      users: {
        windmill: [PostgresqlSpecUsers.CREATEDB],
      },
      databases: {
        windmill_db: "windmill",
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
          "local all postgres peer",
          "local all all peer",
          "hostssl all postgres all scram-sha-256",
          "hostssl windmill_db windmill all scram-sha-256",
          "hostssl replication standby all scram-sha-256",
          "host all postgres all scram-sha-256",
          "host windmill_db windmill all scram-sha-256",
          "host replication standby all scram-sha-256",
        ],
        slots: {},
      },
      enableShmVolume: true,
    },
  });
}
