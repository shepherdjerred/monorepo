import type { EnvVar } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import type { ForumRelease } from "./index.ts";

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
