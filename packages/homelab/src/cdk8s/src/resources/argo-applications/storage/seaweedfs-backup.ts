import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  ConfigMap,
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Secret,
  Volume,
} from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";

/**
 * The `backblaze-seaweedfs-backups` item (OpenTofu `backblaze` stack): a key
 * scoped to the Backblaze `seaweedfs-backups` bucket.
 */
export const BACKBLAZE_SEAWEEDFS_BACKUPS_ITEM_ID = "q3t3h5dkrqwtbllgybca7pjvke";

/**
 * Buckets `filer.backup` does not copy, with why each can be lost. Every other
 * bucket, including one created later, is backed up.
 */
export const SEAWEEDFS_BACKUP_EXCLUDED_BUCKETS: Readonly<
  Record<string, string>
> = {
  "better-skill-capped": "Static site, rebuilt from the repository",
  "ci-handoff": "Ephemeral CI handoff data",
  clauderon: "Retired static site",
  cook: "Static site, rebuilt from the repository",
  "cross-compilers": "Static site, rebuilt from the repository",
  "glitter-boys-ppl": "Public asset, rebuilt from the repository",
  "landing-pages": "Static site, rebuilt from the repository",
  resume: "Static site, rebuilt from the repository",
  "scout-design-system": "Static site, rebuilt from the repository",
  "scout-frontend": "Static site, rebuilt from the repository",
  "scout-frontend-beta": "Static site, rebuilt from the repository",
  "scout-site-releases": "Release artifacts, rebuilt from the repository",
  "sjer-red": "Static site, rebuilt from the repository",
  "statically-typed": "Static site, rebuilt from the repository",
  "stocks-sjer-red": "Static site, rebuilt from the repository",
  "ts-mc": "Retired portal; objects expire after 90 days",
  "ts-mc-docs": "Static site, rebuilt from the repository",
  webring: "Static site, rebuilt from the repository",
  "wiki-sjer-red": "Static site, rebuilt from the repository",
};

/**
 * `filer.backup`'s sink. Objects land at `<bucket>/<key>`. Deletes are
 * mirrored, and the bucket keeps a replaced or deleted object's previous
 * version for 30 days. The access key comes from the environment
 * (`WEED_SINK_S3_*`), never from this file.
 */
export const SEAWEEDFS_BACKUP_REPLICATION_TOML = `[sink.s3]
enabled = true
bucket = "seaweedfs-backups"
region = "us-west-004"
endpoint = "https://s3.us-west-004.backblazeb2.com"
directory = "/"
is_incremental = false
s3_force_path_style = true
# Always 64 MiB parts, not the source's chunk size: objects up to 625 GiB,
# with at most 4 parts (256 MiB) buffered at once.
keep_part_size = false
uploader_part_size = 64
uploader_max_upload_parts = 10000
uploader_concurrency = 4
`;

/**
 * Copies SeaweedFS objects to Backblaze as they change. `filer.backup`
 * follows the filer's metadata stream from a checkpoint the filer stores, so
 * a restart resumes where it stopped. One replica: two would race on that
 * checkpoint.
 *
 * `-initialSnapshot` seeds Backblaze by walking the live tree before
 * subscribing; replaying the metadata log from its start would miss objects
 * older than the log. It re-walks on every start, so it is removed once the
 * first walk logs `initialSnapshot done`.
 */
export function createSeaweedfsBackup(chart: Chart): Deployment {
  const credentials = new OnePasswordItem(
    chart,
    "seaweedfs-backup-credentials-onepassword",
    {
      spec: { itemPath: vaultItemPath(BACKBLAZE_SEAWEEDFS_BACKUPS_ITEM_ID) },
      metadata: { name: "seaweedfs-backup-backblaze", namespace: "seaweedfs" },
    },
  );
  const secret = Secret.fromSecretName(
    chart,
    "seaweedfs-backup-credentials-secret",
    credentials.name,
  );

  const config = new ConfigMap(chart, "seaweedfs-backup-config", {
    metadata: { name: "seaweedfs-backup-config", namespace: "seaweedfs" },
    data: { "replication.toml": SEAWEEDFS_BACKUP_REPLICATION_TOML },
  });

  const deployment = new Deployment(chart, "seaweedfs-backup", {
    metadata: {
      name: "seaweedfs-backup",
      namespace: "seaweedfs",
      labels: { app: "seaweedfs-backup" },
    },
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    dockerRegistryAuth: Secret.fromSecretName(
      chart,
      "seaweedfs-backup-pull-secret",
      "dockerhub-pull-seaweedfs",
    ),
  });
  deployment.podMetadata.addAnnotation(
    "checksum/config",
    new Bun.CryptoHasher("sha256")
      .update(SEAWEEDFS_BACKUP_REPLICATION_TOML)
      .digest("hex"),
  );

  const excludedPaths = Object.keys(SEAWEEDFS_BACKUP_EXCLUDED_BUCKETS)
    .toSorted()
    .map((bucket) => `/buckets/${bucket}`);
  const container = deployment.addContainer({
    name: "filer-backup",
    image: `chrislusf/seaweedfs:${versions["chrislusf/seaweedfs"]}`,
    command: ["/usr/bin/weed"],
    args: [
      "filer.backup",
      "-filer=seaweedfs-filer-client:8888",
      "-filerPath=/buckets",
      `-filerExcludePaths=${excludedPaths.join(",")}`,
      "-doDeleteFiles",
      "-initialSnapshot",
    ],
    envVariables: {
      WEED_SINK_S3_AWS_ACCESS_KEY_ID: EnvValue.fromSecretValue({
        secret,
        key: "B2_ACCESS_KEY_ID",
      }),
      WEED_SINK_S3_AWS_SECRET_ACCESS_KEY: EnvValue.fromSecretValue({
        secret,
        key: "B2_SECRET_ACCESS_KEY",
      }),
    },
    securityContext: {
      ensureNonRoot: true,
      readOnlyRootFilesystem: true,
      user: 1000,
      group: 1000,
    },
    resources: {
      cpu: { request: Cpu.millis(50), limit: Cpu.millis(1000) },
      memory: { request: Size.mebibytes(128), limit: Size.mebibytes(1024) },
    },
  });
  const configVolume = Volume.fromConfigMap(
    chart,
    "seaweedfs-backup-config-volume",
    config,
  );
  deployment.addVolume(configVolume);
  container.mount("/etc/seaweedfs", configVolume, { readOnly: true });
  const tmp = Volume.fromEmptyDir(chart, "seaweedfs-backup-tmp", "tmp");
  deployment.addVolume(tmp);
  container.mount("/tmp", tmp);
  return deployment;
}
