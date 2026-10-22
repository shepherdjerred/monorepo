import { DeliveryError } from "#domain/error.ts";
import {
  PipelineRevisionSchema,
  StageSchema,
  type Principal,
} from "#shared/contract.ts";
import { attestationStageKey } from "#shared/model/stage-keys.ts";
import { requireScope } from "#infrastructure/auth.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  fingerprint,
  required,
  wire,
} from "#infrastructure/delivery-records.ts";
import {
  AttestationRequestSchema,
  type AttestationRequest,
} from "#shared/model/route-contract.ts";

/**
 * An operator tool outside the cluster runs an operator-run deployment's
 * effects; Delivery records each declared stage it attests as a settled
 * stage with attestation evidence. The executor accepts once every
 * declared stage is attested.
 */
export async function attestStage(
  this: Delivery,
  deploymentId: string,
  raw: AttestationRequest,
  actor: Principal,
) {
  // The operator tool authenticates with an operator credential (X13).
  requireScope(actor, "execute");
  const input = AttestationRequestSchema.parse(raw);
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
  // A replayed attestation carries the same evidence and the same identity.
  const operationId =
    input.evidence.find((entry) => entry.operationId !== undefined)
      ?.operationId ?? `sha256:${fingerprint(input.evidence)}`;
  const stage = await this.stage(
    deploymentId,
    {
      key: attestationStageKey(input.stage),
      status: "succeeded",
      operationId,
      message: `Attested by ${actor.id}`,
      evidence: input.evidence,
    },
    actor,
  );
  return StageSchema.parse(stage);
}
