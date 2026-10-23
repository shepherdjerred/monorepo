import { DeliveryError } from "#domain/error.ts";
import {
  PipelineRevisionSchema,
  StageSchema,
  type Principal,
} from "#shared/contract.ts";
import { attestationStageKey } from "#shared/model/stage-keys.ts";
import { recordStageIn } from "#infrastructure/execution/stages.ts";
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

/** Acts by which an identity owns a deployment's execution (D7, D8). */
const OWNERSHIP_ACTIONS = [
  "deployment.claimed",
  "deployment.lease_renewed",
  "deployment.handed_off",
  "deployment.handoff_claimed",
];

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
  // Attestation is the gate on an operator-run deployment, so it comes from
  // a distinct operator identity (X13): the `attest` scope, never an
  // executor credential, never an identity that owns this deployment.
  requireScope(actor, "attest");
  if (actor.scopes.includes("execute"))
    throw new DeliveryError(
      "FORBIDDEN",
      "An executor credential never attests an operator-run stage",
    );
  const owner = await this.database.audit.count({
    where: {
      entityId: deploymentId,
      actor: actor.id,
      action: { in: OWNERSHIP_ACTIONS },
    },
  });
  if (owner > 0)
    throw new DeliveryError(
      "FORBIDDEN",
      "An identity that owns this deployment never attests its stages",
    );
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
  // The executor's stage write refuses attestation keys and admits only the
  // owning executor, so the attestor records its stage directly. An
  // attestation is no proof that the
  // executor is alive, so it never renews the executor's lease (D7).
  const stage = await this.database.$transaction(async (tx) =>
    recordStageIn(
      tx,
      deploymentId,
      {
        key: attestationStageKey(input.stage),
        status: "succeeded",
        operationId,
        message: `Attested by ${actor.id}`,
        evidence: input.evidence,
      },
      { actor, leaseSeconds: null },
    ),
  );
  return StageSchema.parse(stage);
}
