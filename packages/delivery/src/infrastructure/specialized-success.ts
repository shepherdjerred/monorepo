import {
  siteReleaseOf,
  specializedStageKey,
} from "#shared/model/recipe-view.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";
import { z } from "zod";
import { DeliveryError } from "#domain/error.ts";
import { PipelineRevisionSchema } from "#shared/contract.ts";
import { required, wire } from "./delivery-records.ts";
import { recordedByStage, version, type Transaction } from "./delivery-data.ts";
import { validateTrmnlSuccess } from "./trmnl-policy.ts";

/** Same deterministic identity used by the source-owned execution adapters. */
export function specializedOperationId(identity: string) {
  return deliveryOperationId(identity);
}

/** v1 tags Scout's combined frontend; a model static-site step tags its kind. */
const SiteAcceptanceSchema = z
  .object({
    adapter: z.enum(["scout-site", "static-site"]),
    archiveArtifactId: z.string(),
    archiveDigest: z.string(),
    versionSetRevisionId: z.string(),
    bucket: z.string(),
  })
  .strict();

function summary(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export async function validateSpecializedSuccess(
  tx: Transaction,
  deployment: {
    id: string;
    kind: string;
    pipelineRevisionId: string;
    versionSetRevisionId: string;
  },
) {
  if (["adopt-worker", "retire-host"].includes(deployment.kind)) return;
  const pipeline = PipelineRevisionSchema.parse(
    wire(
      required(
        await tx.pipeline.findUnique({
          where: { id: deployment.pipelineRevisionId },
        }),
        "Pipeline",
      ),
    ),
  ).definition;
  await validateTrmnlSuccess(tx, { ...deployment, pipeline });
  const site = siteReleaseOf(pipeline);
  if (site === undefined) return;
  const stages = await tx.stage.findMany({
    where: { deploymentId: deployment.id },
  });
  const evidence = await tx.evidence.findMany({
    where: { deploymentId: deployment.id },
  });
  const selected = await version(tx, deployment.versionSetRevisionId);
  const archive = selected.components[site.archiveComponent];
  const key = specializedStageKey(pipeline, "static-site");
  const expectedOperation = specializedOperationId(`${deployment.id}:${key}`);
  const completed = stages.some(
    (stage) =>
      stage.key === key &&
      stage.status === "succeeded" &&
      stage.operationId === expectedOperation,
  );
  const accepted = evidence.some((entry) => {
    const parsed = SiteAcceptanceSchema.safeParse(summary(entry.summary));
    return (
      entry.kind === "acceptance" &&
      recordedByStage(entry.id, deployment.id, key) &&
      entry.operationId === expectedOperation &&
      parsed.success &&
      parsed.data.archiveArtifactId === archive?.id &&
      parsed.data.archiveDigest === archive.digest &&
      parsed.data.versionSetRevisionId === selected.id &&
      parsed.data.bucket === site.bucket
    );
  });
  if (!completed || !accepted)
    throw new DeliveryError(
      "INVALID",
      "Combined Scout success requires completed frontend activation and exact archive acceptance evidence under the backend release lock",
    );
}
