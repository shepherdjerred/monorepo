import { DeliveryError } from "#domain/error.ts";
import { DeploymentSchema } from "#shared/contract.ts";
import type { EvidenceInput, Principal } from "#shared/contract.ts";
import {
  fingerprint,
  wire,
  lock,
  required,
  audit,
} from "#infrastructure/delivery-records.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import {
  terminal,
  environment,
  evidence,
} from "#infrastructure/delivery-data.ts";
import { findIntent } from "#infrastructure/recovery-intents.ts";
import { releaseDeploymentLocks } from "#infrastructure/recovery-settlement.ts";

/**
 * Settles a pending `argo` recovery intent with independent Application
 * readback (4.15, I1, I2): the only way an ambiguous ordinary release
 * gives up its locks, target and platform alike. The intent comes first; settlement rechecks its
 * binding generation and keeps the deployment's original result (I3).
 */
export async function settleArgoIntent(
  this: Delivery,
  ...args: [
    intentId: string,
    reason: string,
    actor: Principal,
    settledEvidence: EvidenceInput[],
  ]
) {
  const [intentId, reason, actor, settledEvidence] = args;
  if (
    !settledEvidence.some(
      (entry) =>
        entry.kind === "reconciliation" && entry.operationId !== undefined,
    )
  )
    throw new DeliveryError(
      "INVALID",
      "Recovery requires independently inspected settled external operation evidence",
    );
  return this.database.$transaction(async (tx) => {
    await lock(tx, "delivery:claim");
    const intent = await findIntent(tx, intentId, "argo");
    if (intent.status !== "pending")
      throw new DeliveryError(
        "CONFLICT",
        "The recovery intent is already settled",
      );
    const deploymentId = intent.deploymentId;
    await lock(tx, `deployment:${deploymentId}`);
    const row = required(
      await tx.deployment.findUnique({ where: { id: deploymentId } }),
      "Deployment",
    );
    if (!row.recoveryRequired || !terminal.has(row.status))
      throw new DeliveryError(
        "CONFLICT",
        "Deployment does not require lock recovery",
      );
    const env = await environment(tx, row.environmentId);
    if (env.generation !== intent.expectedGeneration)
      throw new DeliveryError(
        "CONFLICT",
        "Environment binding generation changed since the recovery intent was opened",
      );
    await evidence(
      tx,
      deploymentId,
      [...settledEvidence, { kind: "preflight", summary: reason }],
      `recovery/${intent.id}`,
    );
    // Settled, the deployment is no longer recovery-required: like finish,
    // it gives up every lock it holds, the platform lock included.
    await releaseDeploymentLocks(tx, deploymentId);
    await tx.environment.updateMany({
      where: { id: row.environmentId, activeDeploymentId: deploymentId },
      data: { activeDeploymentId: null },
    });
    const updated = await tx.deployment.update({
      where: { id: deploymentId },
      data: { recoveryRequired: false },
    });
    await tx.recoveryIntent.update({
      where: { id: intent.id },
      data: {
        status: "succeeded",
        finishedAt: new Date(),
        message: reason,
        evidence: settledEvidence,
        resultFingerprint: fingerprint(settledEvidence),
      },
    });
    await audit(tx, actor, {
      action: "deployment.recovery_settled",
      entityId: deploymentId,
      requestId: intent.id,
    });
    return DeploymentSchema.parse(wire(updated));
  });
}
