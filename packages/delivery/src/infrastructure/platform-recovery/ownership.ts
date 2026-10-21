import type { Transaction } from "#infrastructure/delivery-data.ts";
import { lock, required } from "#infrastructure/delivery-records.ts";
import { DeliveryError } from "#domain/error.ts";
import {
  bareFingerprint,
  findIntent,
} from "#infrastructure/recovery-intents.ts";
import { heldPlatformRecovery, platformIntentView } from "./context.ts";
import { requireNoContentBarrier } from "#infrastructure/content-recovery/ownership.ts";

export async function pendingRecovery(tx: Transaction, intentId: string) {
  await lock(tx, "delivery:claim");
  await requireNoContentBarrier(tx);
  await lock(tx, `platform-recovery:${intentId}`);
  const stored = await findIntent(tx, intentId, "platform");
  if (stored.status !== "pending")
    throw new DeliveryError("CONFLICT", "Platform recovery intent is terminal");
  await lock(
    tx,
    `environment:${required(await tx.deployment.findUnique({ where: { id: stored.deploymentId } }), "Recovery deployment").environmentId}`,
  );
  const held = await heldPlatformRecovery(tx, {
    deploymentId: stored.deploymentId,
    expectedEnvironmentGeneration: stored.expectedGeneration,
  });
  if (held.snapshotFingerprint !== bareFingerprint(stored.fingerprint))
    throw new DeliveryError(
      "CONFLICT",
      "Quarantined infrastructure snapshot changed",
    );
  return { intent: platformIntentView(stored), stored, ...held };
}
