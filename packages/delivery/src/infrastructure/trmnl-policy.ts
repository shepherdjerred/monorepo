import { z } from "zod";
import { DeliveryError } from "#domain/error.ts";
import type {
  StoredRecipeDefinition,
  VersionSetRevision,
} from "#shared/contract.ts";
import {
  kubernetesRecipes,
  specializedStageKey,
  stepApplicationOf,
  trmnlPluginsOf,
} from "#shared/model/recipe-view.ts";
import type { Transaction } from "./delivery-data.ts";
import { recordedByStage, version } from "./delivery-data.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";

export function validateTrmnlSelection(
  pipeline: StoredRecipeDefinition,
  selected: VersionSetRevision,
) {
  const plugins = trmnlPluginsOf(pipeline);
  if (plugins === undefined && selected.serviceId === "trmnl-dashboard")
    throw new DeliveryError(
      "INVALID",
      "TRMNL dashboard releases must include their fixed plugin dependency stage",
    );
  if (plugins === undefined) return;
  // The executor runs every archive step through the one TRMNL client, and
  // settlement reads the first, so a second would overwrite the fixed
  // plugin settings unchecked.
  const archiveSteps = kubernetesRecipes(pipeline)
    .flatMap((recipe) => recipe.steps)
    .filter((step) => step.kind === "archive");
  if (archiveSteps.length > 1)
    throw new DeliveryError(
      "INVALID",
      "A release configures the fixed TRMNL plugins through exactly one archive step",
    );
  const archive = selected.components[plugins.archiveComponent];
  if (
    // The Application that owns the archive step, not a compound's first.
    stepApplicationOf(pipeline, "archive")?.name !== "trmnl-dashboard" ||
    selected.serviceId !== "trmnl-dashboard" ||
    archive?.kind !== "archive" ||
    archive.serviceId !== "trmnl-dashboard" ||
    archive.origin.kind !== "first-party"
  )
    throw new DeliveryError(
      "INVALID",
      "TRMNL dependency configuration requires its fixed dashboard and original qualified plugin archive",
    );
}
const AcceptanceSchema = z
  .object({
    adapter: z.literal("trmnl-plugins"),
    archiveArtifactId: z.string().min(1),
    archiveDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    versionSetRevisionId: z.string().min(1),
    pluginCount: z.literal(3),
  })
  .strict();
export async function validateTrmnlSuccess(
  tx: Transaction,
  input: {
    id: string;
    versionSetRevisionId: string;
    pipeline: StoredRecipeDefinition;
  },
) {
  const { pipeline } = input;
  const plugins = trmnlPluginsOf(pipeline);
  if (plugins === undefined) return;
  const selected = await version(tx, input.versionSetRevisionId);
  validateTrmnlSelection(pipeline, selected);
  const archive = selected.components[plugins.archiveComponent];
  const key = specializedStageKey(pipeline, "archive");
  const expectedOperation = deliveryOperationId(`${input.id}:${key}`);
  const stage = await tx.stage.findUnique({
    where: { deploymentId_key: { deploymentId: input.id, key } },
  });
  const evidence = await tx.evidence.findMany({
    where: {
      deploymentId: input.id,
      kind: "acceptance",
      operationId: expectedOperation,
    },
  });
  const accepted = evidence.some((item) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(item.summary) as unknown;
    } catch {
      return false;
    }
    const result = AcceptanceSchema.safeParse(parsed);
    return (
      recordedByStage(item.id, input.id, key) &&
      result.success &&
      result.data.archiveArtifactId === archive?.id &&
      result.data.archiveDigest === archive.digest &&
      result.data.versionSetRevisionId === selected.id
    );
  });
  if (
    !accepted ||
    stage?.status !== "succeeded" ||
    stage.operationId !== expectedOperation
  )
    throw new DeliveryError(
      "INVALID",
      "TRMNL acceptance requires all three fixed plugin settings independently read back from the exact frozen archive",
    );
}
