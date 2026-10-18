import { writeJsonHandoff } from "./ci-handoff.ts";
import type { ArtifactVersion } from "../../../packages/delivery/src/shared/contract.ts";

export const DELIVERY_IMAGE_DIGESTS_HANDOFF = "delivery-image-digests";

type DigestWriter = (
  digests: Readonly<Record<string, string>>,
  retained?: readonly ArtifactVersion[],
) => Promise<void>;

export function imageDigestWriters(overrides: {
  writeMetadata?: DigestWriter;
  writeDeliveryMetadata?: DigestWriter;
}) {
  return {
    writeMetadata: overrides.writeMetadata ?? setDigestMetadata,
    writeDeliveryMetadata:
      overrides.writeDeliveryMetadata ?? setDeliveryDigestMetadata,
  };
}

/** Legacy deployment candidates omit freshly built runtime-equivalent images. */
export async function setDigestMetadata(
  digests: Readonly<Record<string, string>>,
): Promise<void> {
  await writeJsonHandoff("image-digests", digests);
}

/** Every entry is a candidate built, pushed, and verified by this pipeline. */
export async function setDeliveryDigestMetadata(
  digests: Readonly<Record<string, string>>,
  retained: readonly ArtifactVersion[] = [],
): Promise<void> {
  await writeJsonHandoff(DELIVERY_IMAGE_DIGESTS_HANDOFF, digests);
  await writeJsonHandoff("delivery-retained-image-artifacts", retained);
}
