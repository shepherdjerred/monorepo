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
  return licensedBundle(artifact);
}

function licensedBundle(
  artifact: ArtifactVersion | undefined,
): ArtifactVersion {
  if (
    artifact?.kind !== "archive" ||
    artifact.origin.kind !== "licensed-bundle" ||
    artifact.version !== artifact.origin.xenforoVersion ||
    artifact.uri !==
      `s3://storm-forum-releases/releases/${artifact.digest.slice(7)}.zip`
  ) {
    throw new Error(
      "Forum release requires its exact licensed bundle artifact",
    );
  }
  return artifact;
}

type ForumDetail = Pick<
  DeploymentDetail,
  | "pipeline"
  | "versionSet"
  | "previousAcceptedVersionSet"
  | "configuration"
  | "previousAcceptedConfiguration"
> & {
  forumRecoveredRuntime?: DeploymentDetail["forumRecoveredRuntime"];
  deployment: Pick<DeploymentDetail["deployment"], "id" | "serviceId"> & {
    forumBaselineSnapshot?: DeploymentDetail["deployment"]["forumBaselineSnapshot"];
    kind?: DeploymentDetail["deployment"]["kind"];
  };
};
function previousRelease(
  detail: ForumDetail,
  policy: { imageComponent: string; bundleComponent: string },
) {
  const recovered = detail.forumRecoveredRuntime;
  if (recovered !== null && recovered !== undefined) {
    const original = recovered.image;
    const originalBundle = licensedBundle(recovered.bundle);
    if (
      original.kind !== "image" ||
      original.uri !== "docker.io/shepherdjerred/storm-forum" ||
      original.component !== policy.imageComponent ||
      originalBundle.component !== policy.bundleComponent ||
      originalBundle.version !== recovered.xenforoVersion
    )
      throw new Error(
        "Recovered Forum runtime differs from its original image, bundle or installed version",
      );
    return {
      bundle: originalBundle,
      image: `${original.uri}@${original.digest}`,
      version: recovered.xenforoVersion,
    };
  }
  const previous = detail.previousAcceptedVersionSet;
  if (previous !== null) {
    const version =
      detail.previousAcceptedConfiguration?.content["forum.xenforoVersion"];
    if (version === undefined || version.length === 0)
      throw new Error(
        "Forum upgrade requires an accepted XenForo version before migration",
      );
    return {
      bundle: bundle(previous, policy.bundleComponent),
      image: image(previous, policy.imageComponent),
      version,
    };
  }
  const baseline = detail.deployment.forumBaselineSnapshot;
  if (
    baseline?.bundle.origin.kind !== "licensed-bundle" ||
    baseline.proof.runtime.bundleSha256 !== baseline.bundle.digest.slice(7) ||
    baseline.proof.runtimeImage !==
      `${baseline.image.uri}@${baseline.image.digest}`
  )
    throw new Error(
      "Forum upgrade requires a verified accepted baseline and XenForo version before migration",
    );
  return {
    bundle: baseline.bundle,
    image: baseline.proof.runtimeImage,
    version: baseline.proof.runtime.xenforoVersion,
  };
}

/** Bind migration and pre-upgrade backup inputs to the frozen accepted snapshot. */
export function forumReleaseParameters(
  detail: ForumDetail,
): Record<string, string> {
  const pipeline = detail.pipeline.definition;
  if (pipeline.kind !== "argocd" || pipeline.forumRelease === undefined)
    return {};
  if (detail.deployment.kind === "rollback")
    throw new Error(
      "Forum database upgrades require the independent restoration procedure; a blind image rollback is unsafe",
    );
  if (
    detail.deployment.serviceId !== "storm-forum" ||
    !["storm-forum", "storm-forum-beta"].includes(pipeline.application)
  ) {
    throw new Error(
      "Forum release adapter is restricted to registered forum Applications",
    );
  }
  const previous = previousRelease(detail, pipeline.forumRelease);
  const { imageComponent, bundleComponent } = pipeline.forumRelease;
  if (
    !Object.values(pipeline.artifactParameters).includes(imageComponent) ||
    !/^\d+\.\d+\.\d+$/u.test(
      detail.configuration.content["forum.xenforoVersion"] ?? "",
    )
  ) {
    throw new Error(
      "Forum release requires an observed runtime binding and an explicit selected XenForo version",
    );
  }
  const selectedBundle = bundle(detail.versionSet, bundleComponent);
  if (
    selectedBundle.version !==
    detail.configuration.content["forum.xenforoVersion"]
  )
    throw new Error(
      "Forum selected bundle differs from the exact configured XenForo version",
    );
  const releaseId = createHash("sha256")
    .update(detail.deployment.id)
    .digest("hex")
    .slice(0, 32);
  return {
    "delivery.image": image(detail.versionSet, imageComponent),
    "delivery.releaseId": releaseId,
    "delivery.bundleKey": new URL(selectedBundle.uri).pathname.slice(1),
    "delivery.bundleSha256": selectedBundle.digest.slice("sha256:".length),
    "delivery.previousBundleSha256": previous.bundle.digest.slice(
      "sha256:".length,
    ),
    "delivery.previousXenforoVersion": previous.version,
    "delivery.previousRuntimeImage": previous.image,
  };
}
