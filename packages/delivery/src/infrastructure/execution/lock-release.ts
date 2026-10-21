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
  id,
  environment,
  evidence,
} from "#infrastructure/delivery-data.ts";
import { createIntent } from "#infrastructure/recovery-intents.ts";

/** Independent Argo readback settles an ambiguous ordinary release as an `argo` recovery intent. */
export async function releaseLock(
  this: Delivery,
  ...args: [
    deploymentId: string,
    reason: string,
    actor: Principal,
    settledEvidence: EvidenceInput[],
  ]
) {
  const [deploymentId, reason, actor, settledEvidence] = args;
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
    const intent = await createIntent(tx, {
      id: id(),
      kind: "argo",
      deploymentId,
      requestedBy: actor.id,
      reason,
      expectedGeneration: env.generation,
      snapshotFingerprint: fingerprint({
        deploymentId,
        resultFingerprint: row.resultFingerprint,
        generation: env.generation,
      }),
    });
    await evidence(
      tx,
      deploymentId,
      [...settledEvidence, { kind: "preflight", summary: reason }],
      `recovery/${intent.id}`,
    );
    await tx.targetLock.deleteMany({ where: { deploymentId } });
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
      action: "deployment.lock_released",
      entityId: deploymentId,
      requestId: intent.id,
    });
    return DeploymentSchema.parse(wire(updated));
  });
}
