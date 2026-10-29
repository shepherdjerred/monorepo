import { DeliveryClientError } from "../../../packages/delivery/src/shared/client-error.ts";
import type { LatestRetainableArtifactQuery } from "../../../packages/delivery/src/shared/contract.ts";
import {
  CANONICAL_IMAGE_TARGETS,
  imageIdentity,
  qualifiedImage,
  type QualifiedImageInventory,
} from "../../../scripts/lib/image-pin-catalog.ts";
import {
  publicationOwners,
  type PublicationOwners,
} from "../../../packages/ops-model/src/delivery-catalog/publication-owners.ts";
import { requireEnv } from "../../../scripts/lib/run.ts";
import { ensureAncestor } from "../selectors/ensure-ancestor.ts";
import type { BuildxCommandResult } from "./bake-retry.ts";

type LiveCatalogExecutor = (
  command: readonly string[],
) => Promise<BuildxCommandResult>;
type RetainableImageReader = (
  query: LatestRetainableArtifactQuery,
) => Promise<unknown>;

/** This main pipeline's number, the order-key bound for Delivery bases (B4). */
export function currentPipelineNumber(
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): number {
  const raw = environment["CI_PIPELINE_NUMBER"];
  if (
    raw === undefined ||
    !/^[1-9]\d*$/.test(raw) ||
    !Number.isSafeInteger(Number(raw))
  )
    throw new Error("CI_PIPELINE_NUMBER must be a positive safe integer");
  return Number(raw);
}

/**
 * Each image's comparison base: Delivery's newest pending or verified original
 * before this pipeline. A pipeline that starts before the previous one
 * qualifies still compares against, and retains, that pipeline's images (B2);
 * Delivery verifies the retaining build only after the original's build.
 * Images are looked up under the registry's owners (v1 until the window's
 * catalog flip); an image whose owner Delivery no longer admits has no base.
 */
export async function readRetainableImages(
  read?: RetainableImageReader,
  beforePipeline = currentPipelineNumber(),
  owners: PublicationOwners = publicationOwners("v1"),
): Promise<QualifiedImageInventory> {
  let reader = read;
  if (reader === undefined) {
    const { createDeliveryClient } =
      await import("../../../packages/delivery/src/shared/client.ts");
    reader = createDeliveryClient({
      baseUrl: requireEnv("DELIVERY_URL"),
      headers: { Authorization: `Bearer ${requireEnv("DELIVERY_API_TOKEN")}` },
    }).latestRetainableArtifact;
  }
  const entries = await Promise.all(
    CANONICAL_IMAGE_TARGETS.map(async (name) => {
      const { serviceId, component, kind } = imageIdentity(name, owners);
      // Delivery admits no builds of a retired service; nothing to retain.
      if (!owners.admits(serviceId)) return;
      try {
        return [
          name,
          qualifiedImage(
            name,
            await reader({ serviceId, component, kind, beforePipeline }),
            owners,
          ),
        ] as const;
      } catch (error) {
        if (error instanceof DeliveryClientError && error.status === 404)
          return;
        throw error;
      }
    }),
  );
  return new Map(entries.filter((entry) => entry !== undefined));
}

/** Only the extension's whole-successful-pipeline source may bound affected selection. */
export async function lastSuccessfulImageReleaseCommit(
  currentCommit: string,
  executor: LiveCatalogExecutor,
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): Promise<string | undefined> {
  const commit = environment["CI_LAST_IMAGE_RELEASE_COMMIT"];
  const pipeline = environment["CI_LAST_IMAGE_RELEASE_PIPELINE"];
  if (pipeline === undefined || pipeline.length === 0) return undefined;
  if (!/^[1-9]\d*$/.test(pipeline) || !Number.isSafeInteger(Number(pipeline)))
    throw new Error("Image release pipeline must be a positive safe integer");
  if (commit === undefined || commit.length === 0)
    throw new Error("Image release pipeline has no corresponding commit");
  const event = environment["CI_PIPELINE_EVENT"];
  return (await ensureAncestor(
    commit,
    currentCommit,
    executor,
    event === "push" || event === "manual",
  ))
    ? commit
    : undefined;
}
