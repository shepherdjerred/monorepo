import {
  Postgresql,
  PostgresqlSpecPostgresqlVersion,
  PostgresqlSpecUsers,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/acid.zalan.do.ts";
import type { Chart } from "cdk8s";

export function createTrackerTrackerPostgreSQLDatabase(chart: Chart) {
  return new Postgresql(chart, "tracker-tracker-postgresql", {
    metadata: {
      name: "tracker-tracker-postgresql",
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
        size: "16Gi",
        storageClass: "zfs-ssd",
      },
      users: {
        trackertracker: [PostgresqlSpecUsers.CREATEDB],
      },
      databases: {
        tracker_tracker: "trackertracker",
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
          "hostssl tracker_tracker trackertracker all scram-sha-256",
          // Tracker Tracker's upstream image builds a plain postgresql:// URL
          // from POSTGRES_* and does not expose a TLS setting.
          "host tracker_tracker trackertracker all scram-sha-256",
          "hostssl replication standby all scram-sha-256",
          "local all all trust",
        ],
        slots: {},
      },
    },
  });
}
