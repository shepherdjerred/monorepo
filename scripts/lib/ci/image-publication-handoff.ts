import { writeJsonHandoff } from "./ci-handoff.ts";

export const DELIVERY_IMAGE_DIGESTS_HANDOFF = "delivery-image-digests";

type DigestWriter = (
  digests: Readonly<Record<string, string>>,
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
): Promise<void> {
  await writeJsonHandoff(DELIVERY_IMAGE_DIGESTS_HANDOFF, digests);
}

export async function setVersionCatalogMetadata(source: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error("Version catalog handoff is not valid JSON", {
      cause: error,
    });
  }
  await writeJsonHandoff("version-catalog", parsed);
}
