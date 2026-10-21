import { writeJsonHandoff } from "./ci-handoff.ts";
import type { ArtifactVersion } from "../../../packages/delivery/src/shared/contract.ts";

export const DELIVERY_IMAGE_DIGESTS_HANDOFF = "delivery-image-digests";

/**
 * Fresh digests are candidates this pipeline built, pushed, and verified.
 * Retained artifacts are qualified originals whose bytes this pipeline did
 * not replace: images it did not build plus content-unchanged candidates.
 */
export async function setDeliveryDigestMetadata(
  digests: Readonly<Record<string, string>>,
  retained: readonly ArtifactVersion[],
): Promise<void> {
  await writeJsonHandoff(DELIVERY_IMAGE_DIGESTS_HANDOFF, digests);
  await writeJsonHandoff("delivery-retained-image-artifacts", retained);
}
