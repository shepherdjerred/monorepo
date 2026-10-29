import type { EnvVar } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import type { ForumRelease } from "./release-schema.ts";
import { FORUM_RECOVERY_ANNOTATIONS } from "@shepherdjerred/ops-model/forum-recovery.ts";

export function forumRecoveryEnvironment(release: ForumRelease): EnvVar[] {
  return [
    { name: "RUNTIME_IMAGE", value: release.image },
    { name: "FORUM_RELEASE_ID", value: release.releaseId },
    ...Object.entries({
      FORUM_RECOVERY_INTENT_ID: FORUM_RECOVERY_ANNOTATIONS.intent,
      FORUM_RECOVERY_ACTION: FORUM_RECOVERY_ANNOTATIONS.action,
    }).map(([name, annotation]) => ({
      name,
      valueFrom: {
        fieldRef: { fieldPath: `metadata.annotations['${annotation}']` },
      },
    })),
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
