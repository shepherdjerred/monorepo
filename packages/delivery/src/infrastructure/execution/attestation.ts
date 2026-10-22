import { z } from "zod";
import { DeliveryError } from "#domain/error.ts";
import { PipelineRevisionSchema, type Principal } from "#shared/contract.ts";
import { IdentifierSchema } from "#shared/artifact-contract.ts";
import { attestationStageKey } from "#shared/model/recipe-contract.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { required, wire } from "#infrastructure/delivery-records.ts";

/** What an attested operator tool reports for one declared stage (section 5, operator-run). */
export const AttestStageSchema = z.strictObject({
  stage: IdentifierSchema,
  operationId: z.string().min(1).max(200),
  summary: z.string().trim().min(1).max(4000),
  url: z.url().optional(),
});
export type AttestStage = z.infer<typeof AttestStageSchema>;

/**
 * An operator tool outside the cluster runs an operator-run deployment's
 * effects; Delivery records each declared stage it attests as a settled
 * stage with attestation evidence. The executor accepts once every
 * declared stage is attested.
 */
export async function attestStage(
  this: Delivery,
  deploymentId: string,
  raw: AttestStage,
  actor: Principal,
) {
  requireScope(actor, "deploy");
  const input = AttestStageSchema.parse(raw);
  const row = await this.database.deployment.findUniqueOrThrow({
    where: { id: deploymentId },
  });
  const recipe = PipelineRevisionSchema.parse(
    wire(
      required(
        await this.database.pipeline.findUnique({
          where: { id: row.pipelineRevisionId },
        }),
        "Recipe",
      ),
    ),
  ).definition;
  if (recipe.kind !== "operator-run")
    throw new DeliveryError(
      "INVALID",
      "Only an operator-run deployment takes operator attestations",
    );
  if (!recipe.stages.includes(input.stage))
    throw new DeliveryError(
      "INVALID",
      `Stage ${input.stage} is not one the recipe asks the operator to attest`,
    );
  return this.stage(
    deploymentId,
    {
      key: attestationStageKey(input.stage),
      status: "succeeded",
      operationId: input.operationId,
      message: `Attested by ${actor.id}`,
      evidence: [
        {
          kind: "attestation",
          operationId: input.operationId,
          summary: input.summary,
          ...(input.url === undefined ? {} : { url: input.url }),
        },
      ],
    },
    actor,
  );
}
