import type { EnvVar } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import type { ForumRelease } from "./release-schema.ts";

export function upgradeBackupEnvironment(
  source: NonNullable<ForumRelease["preUpgradeBackup"]>,
  credentials: (names: readonly string[]) => EnvVar[],
): EnvVar[] {
  return [
    ...credentials(["BACKUP_ACCESS_KEY", "BACKUP_SECRET_KEY"]),
    {
      name: "BACKUP_ENDPOINT",
      value: "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
    },
    { name: "BACKUP_BUCKET", value: "storm-forum-backups" },
    { name: "BACKUP_SOURCE_BUNDLE_SHA256", value: source.bundleSha256 },
    { name: "BACKUP_SOURCE_XENFORO_VERSION", value: source.xenforoVersion },
    { name: "BACKUP_SOURCE_RUNTIME_IMAGE", value: source.runtimeImage },
  ];
}

export function forumBootstrapEnvironment(
  release: Pick<ForumRelease, "stage" | "bundleKey" | "bundleSha256">,
): EnvVar[] {
  return [
    { name: "STORM_FORUM_STAGE", value: release.stage },
    { name: "DB_HOST", value: "storm-forum-database" },
    { name: "DB_NAME", value: "storm" },
    { name: "DB_USER", value: "storm" },
    {
      name: "BUNDLE_ENDPOINT",
      value: "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
    },
    { name: "BUNDLE_BUCKET", value: "storm-forum-releases" },
    { name: "BUNDLE_KEY", value: release.bundleKey },
    { name: "BUNDLE_SHA256", value: release.bundleSha256 },
  ];
}
