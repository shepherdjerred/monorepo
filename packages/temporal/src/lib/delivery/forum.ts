import { createHash } from "node:crypto";
import type {
  ArtifactVersion,
  DeploymentDetail,
  VersionSetRevision,
} from "@shepherdjerred/delivery/contract";

function image(set: VersionSetRevision, component: string): string {
  const artifact = set.components[component];
  if (
    artifact?.kind !== "image" ||
    artifact.uri !== "docker.io/shepherdjerred/storm-forum"
  ) {
    throw new Error(
      "Forum release requires its exact registered runtime image",
    );
  }
  return `${artifact.uri}@${artifact.digest}`;
}

function bundle(set: VersionSetRevision, component: string): ArtifactVersion {
  const artifact = set.components[component];
  if (
    artifact?.kind !== "archive" ||
    !/^s3:\/\/storm-forum-releases\/releases\/[\w.-]+\.zip$/u.test(artifact.uri)
  ) {
    throw new Error(
      "Forum release requires its exact licensed bundle artifact",
    );
  }
  return artifact;
}

/** Bind migration and pre-upgrade backup inputs to the frozen accepted snapshot. */
export function forumReleaseParameters(
  detail: Pick<
    DeploymentDetail,
    "pipeline" | "versionSet" | "previousAcceptedVersionSet"
  > & {
    deployment: Pick<
      DeploymentDetail["deployment"],
      "id" | "serviceId" | "configuration" | "previousAcceptedConfiguration"
    >;
  },
): Record<string, string> {
  const pipeline = detail.pipeline.definition;
  if (pipeline.kind !== "argocd" || pipeline.forumRelease === undefined)
    return {};
  if (
    detail.deployment.serviceId !== "storm-forum" ||
    !["storm-forum", "storm-forum-beta"].includes(pipeline.application)
  ) {
    throw new Error(
      "Forum release adapter is restricted to registered forum Applications",
    );
  }
  const previous = detail.previousAcceptedVersionSet;
  const previousVersion =
    detail.deployment.previousAcceptedConfiguration?.["forum.xenforoVersion"];
  if (
    previous === null ||
    previousVersion === undefined ||
    previousVersion.length === 0
  ) {
    throw new Error(
      "Forum upgrade requires a verified accepted baseline and XenForo version before migration",
    );
  }
  const { imageComponent, bundleComponent } = pipeline.forumRelease;
  if (
    !Object.values(pipeline.artifactParameters).includes(imageComponent) ||
    !/^\d+\.\d+\.\d+$/u.test(
      detail.deployment.configuration["forum.xenforoVersion"] ?? "",
    )
  ) {
    throw new Error(
      "Forum release requires an observed runtime binding and an explicit selected XenForo version",
    );
  }
  const selectedBundle = bundle(detail.versionSet, bundleComponent);
  const previousBundle = bundle(previous, bundleComponent);
  const releaseId = createHash("sha256")
    .update(detail.deployment.id)
    .digest("hex")
    .slice(0, 32);
  return {
    "delivery.enabled": "true",
    "delivery.image": image(detail.versionSet, imageComponent),
    "delivery.releaseId": releaseId,
    "delivery.bundleKey": new URL(selectedBundle.uri).pathname.slice(1),
    "delivery.bundleSha256": selectedBundle.digest.slice("sha256:".length),
    "delivery.previousBundleSha256": previousBundle.digest.slice(
      "sha256:".length,
    ),
    "delivery.previousXenforoVersion": previousVersion,
    "delivery.previousRuntimeImage": image(previous, imageComponent),
  };
}
