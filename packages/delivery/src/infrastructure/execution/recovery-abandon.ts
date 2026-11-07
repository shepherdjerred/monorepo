import { DeliveryError } from "#domain/error.ts";
import type { Principal } from "#shared/contract.ts";
import { requireScope } from "#infrastructure/auth.ts";
import {
  audit,
  fingerprint,
  lock,
  required,
} from "#infrastructure/delivery-records.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { terminal } from "#infrastructure/delivery-data.ts";
import { recoveryIntentView } from "#infrastructure/selection/views.ts";

/**
 * Closes a pending recovery intent that no longer guards anything (4.15).
 * An intent outlives its purpose when its deployment has ended without
 * needing recovery, for example after a later settlement or a sweep released
 * the deployment's ownership. Such an intent still counts as a pending
 * observation and blocks control-plane upgrades, new content barriers and
 * the ownership handover. Abandoning one only closes the intent as failed:
 * it releases no lock and never touches the deployment, an intent whose
 * deployment still needs recovery, whose producer barrier is journaled, or
 * whose recovery Workflow was dispatched stays open for its own reader.
 */
export async function abandonRecoveryIntent(
  this: Delivery,
  id: string,
  reason: string,
  actor: Principal,
) {
  requireScope(actor, "admin");
  return this.database.$transaction(async (tx) => {
    await lock(tx, "delivery:claim");
    const intent = required(
      await tx.recoveryIntent.findUnique({ where: { id } }),
      "Recovery intent",
    );
    await lock(tx, `deployment:${intent.deploymentId}`);
    if (intent.status !== "pending") {
      if (
        intent.status === "failed" &&
        intent.resultFingerprint === fingerprint({ abandoned: reason })
      )
        return recoveryIntentView(intent);
      throw new DeliveryError(
        "CONFLICT",
        "The recovery intent is already settled",
      );
    }
    const deployment = required(
      await tx.deployment.findUnique({ where: { id: intent.deploymentId } }),
      "Deployment",
    );
    if (deployment.recoveryRequired || !terminal.has(deployment.status))
      throw new DeliveryError(
        "CONFLICT",
        "The deployment still needs this recovery; settle it with its own reader",
      );
    if (intent.barrier !== null && intent.barrierRestoredAt === null)
      throw new DeliveryError(
        "CONFLICT",
        "The intent holds an unrestored producer barrier; its own recovery restores it",
      );
    if (intent.workflowId !== null)
      throw new DeliveryError(
        "CONFLICT",
        "A recovery Workflow owns this intent; it settles the intent itself",
      );
    const updated = await tx.recoveryIntent.update({
      where: { id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        message: `Abandoned: ${reason}`,
        resultFingerprint: fingerprint({ abandoned: reason }),
      },
    });
    await audit(tx, actor, {
      action: "deployment.recovery_intent_abandoned",
      entityId: intent.deploymentId,
      requestId: id,
      metadata: { kind: intent.kind, reason },
    });
    return recoveryIntentView(updated);
  });
}

/** Every pending recovery intent, oldest first, for an operator to settle or close. */
export async function pendingRecoveryIntents(this: Delivery) {
  const rows = await this.database.recoveryIntent.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => recoveryIntentView(row));
}
