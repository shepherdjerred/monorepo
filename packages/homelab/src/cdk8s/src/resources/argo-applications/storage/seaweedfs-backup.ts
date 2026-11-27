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
import { KubeNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import {
  dnsEgressRule,
  externalHttpsEgressRule,
  tcp,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";

/**
 * The `backblaze-seaweedfs-backups` item (OpenTofu `backblaze` stack): a key
 * scoped to the Backblaze `seaweedfs-backups` bucket.
 */
export const BACKBLAZE_SEAWEEDFS_BACKUPS_ITEM_ID = "q3t3h5dkrqwtbllgybca7pjvke";

/** The S3 sink's client name, which the filer labels its subscriber metrics with. */
export const SEAWEEDFS_BACKUP_CLIENT = "backup_s3";

/**
 * Whole buckets `filer.backup` does not copy, with why each can be lost.
 * Other buckets are backed up, subject to path-specific exclusions.
 */
export const SEAWEEDFS_BACKUP_EXCLUDED_BUCKETS: Readonly<
  Record<string, string>
> = {
  "bazel-cache": "Retired Bazel remote build cache",
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
  "sjer-red": "Static site, rebuilt from the repository",
  "statically-typed": "Static site, rebuilt from the repository",
  "stocks-sjer-red": "Static site, rebuilt from the repository",
  "ts-mc": "Retired portal; objects expire after 90 days",
  "ts-mc-docs": "Static site, rebuilt from the repository",
  webring: "Static site, rebuilt from the repository",
  "wiki-sjer-red": "Static site, rebuilt from the repository",
};

/**
 * Excluded buckets already removed from the `seaweedfs` OpenTofu stack whose
 * historical `/buckets/<name>` entries still appear in the filer changelog and
 * would stall `filer.backup` replay on deleted volumes if not excluded.
 */
export const SEAWEEDFS_RETIRED_BACKUP_EXCLUDED_BUCKETS: ReadonlySet<string> =
  new Set(["bazel-cache"]);

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
# Always 16 MiB parts, not the source's chunk size: objects up to 156 GiB,
# with at most 4 parts (64 MiB) buffered per object being uploaded.
keep_part_size = false
uploader_part_size = 16
uploader_max_upload_parts = 10000
uploader_concurrency = 4
`;

/** The filer `filer.backup` subscribes to: HTTP on 8888, gRPC on 18888. */
const FILER_HOST = "seaweedfs-filer-client";
const FILER_HTTP_PORT = 8888;
const FILER_GRPC_PORT = 18_888;
/** The volume servers, whose HTTP port serves the chunks `filer.backup` reads. */
const VOLUME_HTTP_PORT = 8080;

/** Objects `filer.backup` copies at once (`-concurrency`; upstream default 32). */
export const SEAWEEDFS_BACKUP_CONCURRENCY = 4;

/**
 * Runs before `weed filer.backup`, in the same container so it also runs when
 * the container restarts in place. `filer.backup` reads its checkpoint once at
 * start, and if that read fails (no DNS for the filer, gRPC unavailable) it
 * starts from 1970-01-01 and overwrites the saved checkpoint with the oldest
 * retained changelog entry, replaying months of history. So nothing starts
 * until the filer answers both its HTTP and gRPC ports. It never touches the
 * checkpoint; `weed` then resumes from it as before.
 */
export const SEAWEEDFS_BACKUP_WAIT_FOR_FILER = `filer=${FILER_HOST}
until curl -fsS -o /dev/null --max-time 5 "http://$filer:${String(FILER_HTTP_PORT)}/" &&
  nc -z -w 5 "$filer" ${String(FILER_GRPC_PORT)}; do
  echo "waiting for $filer to answer on ${String(FILER_HTTP_PORT)} and ${String(FILER_GRPC_PORT)}"
  sleep 5
done
exec /usr/bin/weed "$@"`;

/**
 * Copies SeaweedFS objects to Backblaze as they change. `filer.backup`
 * follows the filer's metadata stream from a checkpoint the filer stores, so
 * a restart resumes where it stopped. One replica: two would race on that
 * checkpoint.
 *
 * Backblaze was seeded once with `-initialSnapshot`, which walks the live tree
 * before subscribing and saves the walk's start as the checkpoint. It is not
 * set here: it re-walks on every start, and any failed upload restarts the
 * walk. To re-seed an emptied bucket, run it once by hand.
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

  const excludedPaths = [
    ...Object.keys(SEAWEEDFS_BACKUP_EXCLUDED_BUCKETS).map(
      (bucket) => `/buckets/${bucket}`,
    ),
    // Raw Brim captures expire after 30 days. The sink retains old versions
    // for another 30 days, so leave this prefix on SeaweedFS only.
    "/buckets/brim-sessions/captures/v1",
  ].toSorted();
  const container = deployment.addContainer({
    name: "filer-backup",
    image: `chrislusf/seaweedfs:${versions["chrislusf/seaweedfs"]}`,
    // `sh -c <script> <$0> <args...>`: the args are `weed`'s.
    command: ["/bin/sh", "-c", SEAWEEDFS_BACKUP_WAIT_FOR_FILER, "filer-backup"],
    args: [
      "filer.backup",
      `-filer=${FILER_HOST}:${String(FILER_HTTP_PORT)}`,
      "-filerPath=/buckets",
      `-filerExcludePaths=${excludedPaths.join(",")}`,
      `-concurrency=${String(SEAWEEDFS_BACKUP_CONCURRENCY)}`,
      "-doDeleteFiles",
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
    securityContext: restrictedContainer(1000),
    // TLS and request signing for every object make the copy CPU-bound. Upload
    // buffers bound memory: four objects at once, each with up to four 16 MiB
    // parts in flight, is about 256 MiB. With the upstream default of 32
    // objects and 64 MiB parts the bound was 8 GiB, and a replay of a month
    // of changes OOMed at the 2 GiB limit within seconds of every start. The
    // request is the 14d p95 RSS to 2026-11-08 (0.37Gi); the admission
    // webhook scales live requests by its overcommit annotation.
    resources: {
      cpu: { request: Cpu.millis(500), limit: Cpu.millis(4000) },
      memory: { request: Size.mebibytes(384), limit: Size.mebibytes(2048) },
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

  // It follows the filer's metadata stream over gRPC and reads its KMS key
  // from the filer, reads chunks over HTTP from the volume servers the filer
  // names, and writes to Backblaze B2 over HTTPS. It serves nothing and
  // exposes no metrics: the filer reports its subscriber's progress.
  new KubeNetworkPolicy(chart, "seaweedfs-backup-netpol", {
    metadata: { name: "seaweedfs-backup-netpol", namespace: "seaweedfs" },
    spec: {
      podSelector: { matchLabels: deployment.matchLabels },
      policyTypes: ["Ingress", "Egress"],
      ingress: [],
      egress: [
        dnsEgressRule(),
        {
          to: [{ podSelector: { matchLabels: seaweedfsComponent("filer") } }],
          ports: [tcp(FILER_HTTP_PORT), tcp(FILER_GRPC_PORT)],
        },
        {
          to: [{ podSelector: { matchLabels: seaweedfsComponent("volume") } }],
          ports: [tcp(VOLUME_HTTP_PORT)],
        },
        externalHttpsEgressRule(),
      ],
    },
  });
  return deployment;
}

/** The labels of one component's pods in the upstream SeaweedFS chart. */
function seaweedfsComponent(component: string) {
  return {
    "app.kubernetes.io/name": "seaweedfs",
    "app.kubernetes.io/component": component,
  };
}
