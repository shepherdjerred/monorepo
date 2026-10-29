import { writeJsonHandoff } from "./ci-handoff.ts";
import type { ArtifactVersion } from "../../../packages/delivery/src/shared/contract.ts";
import type { OwnerRegistry } from "@shepherdjerred/ops-model/delivery-catalog/publication-owners.ts";
import { z } from "zod";

export const DELIVERY_IMAGE_DIGESTS_HANDOFF = "delivery-image-digests";
export const DELIVERY_CATALOG_REGISTRY_HANDOFF = "delivery-catalog-registry";

export function parseDeliveryCatalogRegistry(raw: string): OwnerRegistry {
  return z.enum(["v1", "v2"]).parse(JSON.parse(raw));
}

/** Freeze the same registry selection the image producer used for downstream jobs. */
export async function setDeliveryCatalogRegistry(
  registry: OwnerRegistry,
): Promise<void> {
  await writeJsonHandoff(DELIVERY_CATALOG_REGISTRY_HANDOFF, registry);
}

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
