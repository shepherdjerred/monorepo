import { DeliveryClientError } from "../../../packages/delivery/src/shared/client-error.ts";
import type { LatestQualifiedArtifactQuery } from "../../../packages/delivery/src/shared/contract.ts";
import {
  CANONICAL_IMAGE_TARGETS,
  imageIdentity,
  qualifiedImage,
  type QualifiedImageInventory,
} from "../../../scripts/lib/image-pin-catalog.ts";
import { requireEnv } from "../../../scripts/lib/run.ts";
import { ensureAncestor } from "../selectors/ensure-ancestor.ts";
import type { BuildxCommandResult } from "./bake-retry.ts";

type LiveCatalogExecutor = (
  command: readonly string[],
) => Promise<BuildxCommandResult>;
type QualifiedImageReader = (
  query: LatestQualifiedArtifactQuery,
) => Promise<unknown>;

/** API qualification already proves the entire original producer pipeline. */
export async function readQualifiedImages(
  read?: QualifiedImageReader,
): Promise<QualifiedImageInventory> {
  let reader = read;
  if (reader === undefined) {
    const { createDeliveryClient } =
      await import("../../../packages/delivery/src/shared/client.ts");
    reader = createDeliveryClient({
      baseUrl: requireEnv("DELIVERY_URL"),
      headers: { Authorization: `Bearer ${requireEnv("DELIVERY_API_TOKEN")}` },
    }).latestQualifiedArtifact;
  }
  const entries = await Promise.all(
    CANONICAL_IMAGE_TARGETS.map(async (name) => {
      const { serviceId, component, kind } = imageIdentity(name);
      try {
        return [
          name,
          qualifiedImage(name, await reader({ serviceId, component, kind })),
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
