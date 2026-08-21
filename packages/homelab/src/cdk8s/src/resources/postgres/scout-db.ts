import {
  Postgresql,
  PostgresqlSpecPostgresqlVersion,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/acid.zalan.do.ts";
import type { Chart } from "cdk8s";
import type { Stage } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/scout.ts";

/**
 * Per-stage Scout application database (the backend migrated off SQLite).
 * One cluster per scout namespace; the backend composes DATABASE_URL from
 * the operator-generated `scout.<cluster>.credentials...` secret.
 */
export function createScoutPostgreSQLDatabase(chart: Chart, stage: Stage) {
  const name = `scout-${stage}-postgresql`;
  return new Postgresql(chart, name, {
    metadata: {
      name,
      labels: {
        "velero.io/backup": "enabled",
        "velero.io/exclude-from-backup": "false",
      },
      annotations: {
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
          password_encryption: "scram-sha-256",
        },
      },
      volume: {
        // The whole legacy SQLite DB was ~6Mi at cutover; 16Gi matches the
        // other single-instance clusters and leaves room for WAL churn
        // (Bugsink's ZFS-snapshot bloat lesson: don't undersize).
        size: "16Gi",
        storageClass: "zfs-ssd",
      },
      users: {
        scout: [],
      },
      databases: {
        scout: "scout",
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
          "hostssl scout scout all scram-sha-256",
          // The backend's node-postgres adapter connects without TLS
          // in-namespace; spilo's self-signed cert has no service-hostname
          // SAN (same reason tracker-tracker carries a plain host line).
          "host scout scout all scram-sha-256",
          "hostssl replication standby all scram-sha-256",
          // psql runbooks (pg_dump snapshots, evals sync-beta) via
          // kubectl exec into the postgres pod.
          "local all all trust",
        ],
        slots: {},
      },
    },
  });
}
