import { Chart, JsonPatch } from "cdk8s";
import type {
  Postgresql,
  PostgresqlSpecEnv,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/acid.zalan.do";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";

/**
 * Continuous WAL archiving for the operator-run PostgreSQL data layers.
 *
 * Velero only snapshots the pgdata volume on a schedule; WAL-G adds a
 * nightly base backup plus every WAL segment as it is archived, so a cluster
 * can be restored to any point between snapshots.
 *
 * The archive starts on Velero's R2 bucket and credential (`velero.ts`),
 * under the per-cluster prefixes below, so it needs no new secret to merge
 * and cannot fail on token scope: Velero already writes to this bucket. The
 * dedicated `postgres-wal` bucket (OpenTofu `cloudflare` stack) and its
 * bucket-scoped token (`cloudflare-tokens`, `s3_credential`) replace both
 * through the runbook recorded with this change: create the token and its
 * 1Password item, then change `itemId` and `bucket` here and set the
 * prefixes to `<cluster>/`.
 */
export const POSTGRES_WAL_ARCHIVE = {
  /** Velero's R2 item (`velero.ts`); see the runbook above for the dedicated one. */
  itemId: "ypce2djferc6zf7bocxft36n6a",
  /** Velero's backup bucket; Velero itself only reads `torvalds/`. */
  bucket: "homelab",
  /** Cloudflare R2's S3 endpoint for the homelab account (as in velero.ts). */
  endpoint: "https://48948ed6cd40d73e34d27f0cc10e595f.r2.cloudflarestorage.com",
  /** Operator-emitted Secret keys (1Password field labels) on the item. */
  secretKeys: {
    accessKeyId: "CLOUDFLARE_R2_ACCESS_KEY_ID",
    secretAccessKey: "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
  },
  /**
   * Nightly base backup at 01:00 UTC, Spilo's own default slot and clear of
   * every Velero window (6-hourly at :15, daily 02:30, weekly Mon 03:45).
   */
  backupSchedule: "0 1 * * *",
  /**
   * Base backups WAL-G keeps (`wal-g delete retain FULL n` after each
   * backup); WAL segments are kept back to the oldest retained base backup,
   * so this is one week of point-in-time recovery.
   */
  backupsToRetain: 7,
} as const;

/** The one place each archived cluster's prefix inside the archive bucket is declared. */
export const POSTGRES_WAL_PREFIXES = {
  "delivery-postgresql": "postgres-wal/delivery-postgresql/",
  "temporal-postgresql": "postgres-wal/temporal-postgresql/",
} as const;
export type ArchivedPostgresCluster = keyof typeof POSTGRES_WAL_PREFIXES;

/**
 * On since the window's final root release adopted both clusters into their
 * data-layer charts byte-identically (pod UID and StatefulSet generation
 * unchanged). Turning it on changed each cluster's pod environment, so the
 * operator restarts each cluster's pod once.
 */
export function postgresWalArchiving(): boolean {
  return true;
}

export function postgresWalArchivePrefix(
  cluster: ArchivedPostgresCluster,
): string {
  // WAL-G joins its own paths under the prefix, so it carries no trailing slash.
  return `s3://${POSTGRES_WAL_ARCHIVE.bucket}/${POSTGRES_WAL_PREFIXES[cluster].replace(/\/$/u, "")}`;
}

/** The 1Password-synced Secret the cluster's pods read the R2 credential from. */
export function createPostgresWalArchiveCredentials(
  chart: Chart,
  clusterName: ArchivedPostgresCluster,
): OnePasswordItem {
  return new OnePasswordItem(chart, `${clusterName}-wal-archive`, {
    metadata: { name: `${clusterName}-wal-archive` },
    spec: { itemPath: vaultItemPath(POSTGRES_WAL_ARCHIVE.itemId) },
  });
}

/**
 * Per-cluster Spilo environment, set through the Postgresql manifest's `env`
 * list rather than the operator-wide `pod_environment_*` settings, which
 * would restart and archive every cluster the operator manages.
 *
 * Variable names follow Spilo's ENVIRONMENT.rst (`BACKUP_SCHEDULE`,
 * `BACKUP_NUM_TO_RETAIN`, `WALG_S3_PREFIX`, `AWS_ENDPOINT`, `AWS_REGION`,
 * `WALG_DISABLE_S3_SSE`) and the postgres-operator administrator guide's
 * "WAL archiving and physical basebackups" and "Via Postgres Cluster
 * Manifest" sections (`USE_WALG_BACKUP`, `USE_WALG_RESTORE`, `spec.env`).
 * Spilo's configure_spilo.py enables archiving as soon as `WALG_S3_PREFIX`
 * is set, derives `WALG_S3_ENDPOINT` (path convention) from `AWS_ENDPOINT`,
 * and copies `AWS_S3_FORCE_PATH_STYLE` and the credentials into WAL-G's
 * envdir; the explicit values here keep the intent reviewable.
 */
export function postgresWalArchiveEnv(
  clusterName: ArchivedPostgresCluster,
  credentials: OnePasswordItem,
): PostgresqlSpecEnv[] {
  const fromSecret = (key: string): PostgresqlSpecEnv["valueFrom"] => ({
    secretKeyRef: { name: credentials.name, key },
  });
  return [
    { name: "USE_WALG_BACKUP", value: "true" },
    { name: "USE_WALG_RESTORE", value: "true" },
    { name: "WALG_S3_PREFIX", value: postgresWalArchivePrefix(clusterName) },
    { name: "AWS_ENDPOINT", value: POSTGRES_WAL_ARCHIVE.endpoint },
    { name: "AWS_S3_FORCE_PATH_STYLE", value: "true" },
    { name: "AWS_REGION", value: "auto" },
    { name: "WALG_DISABLE_S3_SSE", value: "true" },
    { name: "BACKUP_SCHEDULE", value: POSTGRES_WAL_ARCHIVE.backupSchedule },
    {
      name: "BACKUP_NUM_TO_RETAIN",
      value: POSTGRES_WAL_ARCHIVE.backupsToRetain.toString(),
    },
    {
      name: "AWS_ACCESS_KEY_ID",
      valueFrom: fromSecret(POSTGRES_WAL_ARCHIVE.secretKeys.accessKeyId),
    },
    {
      name: "AWS_SECRET_ACCESS_KEY",
      valueFrom: fromSecret(POSTGRES_WAL_ARCHIVE.secretKeys.secretAccessKey),
    },
  ];
}

/**
 * Archive one data-layer cluster when WAL archiving is on: the credential
 * mirror plus the cluster's Spilo environment. Off, the cluster renders
 * exactly as its constructor does.
 */
export function archivePostgresWal(
  database: Postgresql,
  clusterName: ArchivedPostgresCluster,
  enabled: boolean = postgresWalArchiving(),
): void {
  if (!enabled) return;
  const credentials = createPostgresWalArchiveCredentials(
    Chart.of(database),
    clusterName,
  );
  database.addJsonPatch(
    JsonPatch.add("/spec/env", postgresWalArchiveEnv(clusterName, credentials)),
  );
}
