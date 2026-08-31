import type { Chart } from "cdk8s";
import {
  Postgresql,
  PostgresqlSpecPostgresqlVersion,
  PostgresqlSpecUsers,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/acid.zalan.do";
import {
  TEMPORAL_POSTGRES_TLS_CA_FILE,
  TEMPORAL_POSTGRES_TLS_CERTIFICATE_FILE,
  TEMPORAL_POSTGRES_TLS_PRIVATE_KEY_FILE,
  TEMPORAL_POSTGRES_TLS_SECRET,
} from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/temporal-db-tls.ts";

export function createTemporalPostgreSQLDatabase(chart: Chart) {
  // The postgres-operator will automatically generate passwords and store them
  // in Kubernetes secrets with the naming pattern:
  // {username}.{clustername}.credentials.postgresql.acid.zalan.do

  return new Postgresql(chart, "temporal-postgresql", {
    metadata: {
      name: "temporal-postgresql",
      labels: {
        "velero.io/backup": "enabled",
        "velero.io/exclude-from-backup": "false",
      },
      annotations: {
        // Prevent ArgoCD from deleting this resource during sync - data loss protection
        "argocd.argoproj.io/sync-options": "Delete=false",
        // Ahead of the schema migration at wave -1, which cannot create a
        // schema in a database that does not exist yet, and behind the
        // server certificate at wave -3 that this cluster serves TLS with.
        "argocd.argoproj.io/sync-wave": "-2",
      },
    },
    spec: {
      numberOfInstances: 1,
      teamId: "homelab",
      tls: {
        secretName: TEMPORAL_POSTGRES_TLS_SECRET,
        certificateFile: TEMPORAL_POSTGRES_TLS_CERTIFICATE_FILE,
        privateKeyFile: TEMPORAL_POSTGRES_TLS_PRIVATE_KEY_FILE,
        // ca.crt in this same secret is cert-manager's copy of the stable CA
        // certificate (see temporal-db-tls.ts) — not this leaf's own
        // certificate, which rotates on every renewal. Because it already
        // ships inside `secretName`, it is mounted at /tls with the leaf and
        // a relative caFile resolves against that same mount.
        //
        // Deliberately NO caSecretName. The operator's generateTlsMounts
        // supports that field only for the "ca.crt resides in a DIFFERENT
        // secret" case: it appends a second volume named after caSecretName
        // and mounts it at /tlsca. Naming the same secret twice therefore
        // emits two volumes both called temporal-postgresql-tls, and the API
        // server rejects the StatefulSet with `spec.template.spec.volumes[3]
        // .name: Duplicate value`. The operator replaces a StatefulSet by
        // deleting it first, so it had already orphaned the running pod
        // before the create failed — leaving the Temporal database with no
        // controller at all until this was corrected.
        caFile: TEMPORAL_POSTGRES_TLS_CA_FILE,
      },
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
        // 32Gi for a ~2.5Gi database, because `zfs-ssd` provisions volumes with
        // ZFS `quotaType: quota`, which counts snapshots against the same quota
        // as live data. Velero retention (12 6hourly + 7 daily + 4 weekly +
        // 3 monthly) holds ~26 snapshots, and this WAL-heavy cluster diverges
        // ~500-700Mi of blocks per snapshot, so snapshots steady-state around
        // 15Gi -- 6x the live dataset. At 16Gi that left 0B writable on
        // 2026-08-27: Postgres could not create postmaster.pid ("Disk quota
        // exceeded"), crash recovery looped, and the Temporal frontend never
        // bound :7233, crashlooping every Temporal worker and Scout beta.
        // quotaType is immutable per-volume and StorageClass parameters are
        // immutable, so sizing around snapshot overhead is the available fix
        // without recreating the volume on a refquota class.
        size: "32Gi",
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
