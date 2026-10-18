import type { Transaction } from "#infrastructure/delivery-data.ts";
import { lock, required } from "#infrastructure/delivery-records.ts";
import { DeliveryError } from "#domain/error.ts";
import { heldPlatformRecovery } from "./context.ts";

export async function pendingRecovery(tx: Transaction, intentId: string) {
  await lock(tx, "delivery:claim");
  await lock(tx, `platform-recovery:${intentId}`);
  const intent = required(
    await tx.platformRecoveryIntent.findUnique({ where: { id: intentId } }),
    "Platform recovery intent",
  );
  if (intent.status !== "pending")
    throw new DeliveryError("CONFLICT", "Platform recovery intent is terminal");
  await lock(
    tx,
    `environment:${required(await tx.deployment.findUnique({ where: { id: intent.deploymentId } }), "Recovery deployment").environmentId}`,
  );
  const held = await heldPlatformRecovery(tx, intent);
  if (held.snapshotFingerprint !== intent.snapshotFingerprint)
    throw new DeliveryError(
      "CONFLICT",
      "Quarantined infrastructure snapshot changed",
    );
  return { intent, ...held };
}
