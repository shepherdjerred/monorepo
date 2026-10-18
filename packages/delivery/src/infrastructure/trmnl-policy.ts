import { z } from "zod";
import { DeliveryError } from "#domain/error.ts";
import type {
  PipelineDefinition,
  VersionSetRevision,
} from "#shared/contract.ts";
import type { Transaction } from "./delivery-data.ts";
import { version } from "./delivery-data.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";

export function validateTrmnlSelection(
  pipeline: PipelineDefinition,
  selected: VersionSetRevision,
) {
  if (
    selected.serviceId === "trmnl-dashboard" &&
    (pipeline.kind !== "argocd" || pipeline.trmnlPlugins === undefined)
  )
    throw new DeliveryError(
      "INVALID",
      "TRMNL dashboard releases must include their fixed plugin dependency stage",
    );
  if (pipeline.kind !== "argocd" || pipeline.trmnlPlugins === undefined) return;
  const archive = selected.components[pipeline.trmnlPlugins.archiveComponent];
  if (
    pipeline.application !== "trmnl-dashboard" ||
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
    pipeline: PipelineDefinition;
  },
) {
  const { pipeline } = input;
  if (pipeline.kind !== "argocd" || pipeline.trmnlPlugins === undefined) return;
  const selected = await version(tx, input.versionSetRevisionId);
  validateTrmnlSelection(pipeline, selected);
  const archive = selected.components[pipeline.trmnlPlugins.archiveComponent];
  const expectedOperation = deliveryOperationId(`${input.id}:trmnl-plugins`);
  const stage = await tx.stage.findUnique({
    where: {
      deploymentId_key: { deploymentId: input.id, key: "trmnl-plugins" },
    },
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
      item.id.startsWith(`${input.id}/stage/trmnl-plugins/`) &&
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
