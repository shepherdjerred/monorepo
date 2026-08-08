import type { Chart } from "cdk8s";
import {
  Postgresql,
  PostgresqlSpecPostgresqlVersion,
  PostgresqlSpecUsers,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/acid.zalan.do";

export function createAlertDashboardPostgreSQLDatabase(chart: Chart) {
  return new Postgresql(chart, "alert-dashboard-postgresql", {
    metadata: {
      name: "alert-dashboard-postgresql",
      labels: {
        "velero.io/backup": "enabled",
        "velero.io/exclude-from-backup": "false",
      },
      annotations: { "argocd.argoproj.io/sync-options": "Delete=false" },
    },
    spec: {
      numberOfInstances: 1,
      teamId: "homelab",
      postgresql: {
        version: PostgresqlSpecPostgresqlVersion.VALUE_16,
        parameters: {
          max_connections: "50",
          shared_buffers: "128MB",
          effective_cache_size: "512MB",
          password_encryption: "scram-sha-256",
          log_min_duration_statement: "1000",
        },
      },
      volume: { size: "16Gi", storageClass: "zfs-ssd" },
      users: { alert_dashboard: [PostgresqlSpecUsers.CREATEDB] },
      databases: { alert_dashboard: "alert_dashboard" },
      resources: {
        requests: { cpu: "50m", memory: "128Mi" },
        limits: { cpu: "250m", memory: "512Mi" },
      },
      patroni: {
        initdb: {
          encoding: "utf8",
          locale: "en_US.utf8",
          "data-checksums": "true",
        },
        pgHba: [
          "local all all peer",
          "hostssl all postgres all scram-sha-256",
          "hostssl alert_dashboard alert_dashboard all scram-sha-256",
          "hostssl replication standby all scram-sha-256",
        ],
        slots: {},
      },
    },
  });
}
