import { ociImageConfigurations } from "@shepherdjerred/ops-model/oci-image-configurations.ts";
import type { ControlPlaneUpgradeSnapshot } from "@shepherdjerred/delivery/contract";
import {
  CONTROL_PLANE_IMAGE_LABEL,
  CONTROL_PLANE_IMAGE_ABI,
} from "@shepherdjerred/ops-model/delivery-control-plane.ts";
import { type RolloutCommandRunner } from "#lib/worker-deployment-proofs.ts";

/** Capability is immutable image metadata, never a runtime behavior switch or caller assertion. */
export async function verifyControlPlaneImageCompatibility(
  snapshot: ControlPlaneUpgradeSnapshot,
  run: RolloutCommandRunner,
) {
  const artifact = snapshot.nextArtifact;
  const reference = `${artifact.uri}@${artifact.digest}`;
  const result = await run([
    "docker",
    "buildx",
    "imagetools",
    "inspect",
    reference,
    "--format",
    "{{json .Image}}",
  ]);
  const images = ociImageConfigurations(JSON.parse(result.stdout));
  if (
    images.some(
      (image) =>
        !image.config.Env.includes(`GIT_SHA=${artifact.sourceRevision}`) ||
        image.config.Labels?.[CONTROL_PLANE_IMAGE_LABEL] !==
          CONTROL_PLANE_IMAGE_ABI,
    )
  )
    throw new Error(
      "Selected image lacks its original baked source or supported Delivery control-plane ABI on a platform",
    );
}
