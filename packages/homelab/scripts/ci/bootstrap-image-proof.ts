import { ociImageConfigurations } from "@shepherdjerred/ops-model/oci-image-configurations.ts";
import {
  CONTROL_PLANE_IMAGE_ABI,
  CONTROL_PLANE_IMAGE_LABEL,
} from "@shepherdjerred/ops-model/delivery-control-plane.ts";

/** buildx emits one OCI config or a platform-keyed map; every runnable variant must carry original provenance. */
export function assertBootstrapImageSource(
  raw: unknown,
  sourceRevision: string,
  version: string,
) {
  const images = ociImageConfigurations(raw);
  for (const image of images)
    if (
      !image.config.Env.includes(`GIT_SHA=${sourceRevision}`) ||
      !image.config.Env.includes(`VERSION=${version}`)
    )
      throw new Error(
        "Bootstrap image lacks its exact original baked source revision on a platform",
      );
}

/** Initial hosting must provide both Delivery Workflow and Activity pollers. */
export function assertBootstrapControlPlaneImage(raw: unknown) {
  if (
    ociImageConfigurations(raw).some(
      (image) =>
        image.config.Labels?.[CONTROL_PLANE_IMAGE_LABEL] !==
        CONTROL_PLANE_IMAGE_ABI,
    )
  )
    throw new Error(
      "Bootstrap control-plane image lacks the supported Workflow-host capability on a platform",
    );
}
