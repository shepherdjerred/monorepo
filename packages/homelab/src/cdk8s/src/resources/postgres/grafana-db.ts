import { Chart } from "cdk8s";
import {
  Postgresql,
  PostgresqlSpecPostgresqlVersion,
  PostgresqlSpecUsers,
} from "../../../generated/imports/acid.zalan.do";

export function createGrafanaPostgreSQLDatabase(chart: Chart) {
  // The postgres-operator will automatically generate passwords and store them
  // in Kubernetes secrets. No need for 1Password in this case!

  // Create a PostgreSQL cluster specifically for Grafana using the Zalando postgres-operator CRD
  return new Postgresql(chart, "grafana-postgresql", {
    metadata: {
      name: "grafana-postgresql",
      namespace: "prometheus", // Same namespace as Grafana
      annotations: {
        // Prevent ArgoCD from deleting this resource during sync - data loss protection
        "argocd.argoproj.io/sync-options": "Delete=false",
      },
    },
    spec: {
      numberOfInstances: 1, // Single node setup for homelab
      teamId: "homelab",
      postgresql: {
        version: PostgresqlSpecPostgresqlVersion.VALUE_16, // Latest stable PostgreSQL version supported
        parameters: {
          // PostgreSQL configuration optimized for Grafana
          max_connections: "200",
          shared_buffers: "256MB",
          effective_cache_size: "1GB",
          maintenance_work_mem: "64MB",
          checkpoint_completion_target: "0.9",
          wal_buffers: "16MB",
          default_statistics_target: "100",
          random_page_cost: "1.1",
          effective_io_concurrency: "200",
          work_mem: "4MB",
          min_wal_size: "1GB",
          max_wal_size: "4GB",
          log_statement: "none", // Reduce logging for performance
          log_min_duration_statement: "1000", // Log only slow queries
        },
      },
      volume: {
        size: "32Gi", // Adequate size for Grafana database
        storageClass: "zfs-ssd", // Using local storage available in the cluster
      },
      users: {
        grafana: [
          PostgresqlSpecUsers.CREATEDB, // Allow Grafana user to create databases
        ],
      },
      databases: {
        grafana: "grafana", // Database owned by the grafana user
      },
      resources: {
        requests: {
          cpu: "100m",
          memory: "256Mi",
        },
        limits: {
          cpu: "500m",
          memory: "1Gi",
        },
      },
      patroni: {
        initdb: {
          encoding: "UTF8",
          locale: "en_US.utf8",
          "data-checksums": "true",
        },
        pgHba: [
          // Allow connections from within the cluster
          "host grafana grafana all md5",
          "host replication standby all md5",
          "local all all trust",
          "host all all all md5",
        ],
        slots: {},
      },
    },
  });
}
