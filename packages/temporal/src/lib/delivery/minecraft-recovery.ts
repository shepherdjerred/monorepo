import { z } from "zod";
import {
  MinecraftRecoveryDetailSchema,
  MinecraftRecoveryIntentSchema,
} from "@shepherdjerred/delivery/contract";
import { deliveryRequest } from "./client.ts";
import { deliveryOperationId } from "./selection.ts";
import { runMinecraftRecovery } from "./minecraft-controller.ts";

/** Shared by the durable Activity and explicit outage command; API independently proves settlement. */
export async function recoverMinecraftIntent(
  intentId: string,
  options: { signal?: AbortSignal; controllerOrigin?: string } = {},
) {
  const path = `minecraft-recovery/${encodeURIComponent(intentId)}`;
  const context = await deliveryRequest(path, MinecraftRecoveryDetailSchema);
  if (context.intent.status !== "pending") return context.intent;
  await runMinecraftRecovery(
    context.deployment,
    intentId,
    deliveryOperationId(
      `${context.deployment.deployment.id}:minecraft-preservation`,
    ),
    {
      ...options,
      onReceipt: async (receipt) => {
        await deliveryRequest(`${path}/controller`, z.unknown(), receipt);
      },
    },
  );
  // The cleanup response is not caller evidence. The API rereads its fixed native controller and Argo.
  return deliveryRequest(`${path}/complete`, MinecraftRecoveryIntentSchema, {
    expectedEnvironmentGeneration: context.intent.expectedEnvironmentGeneration,
    snapshotFingerprint: context.intent.snapshotFingerprint,
  });
}

export async function failMinecraftIntent(intentId: string) {
  const path = `minecraft-recovery/${encodeURIComponent(intentId)}`;
  const current = await deliveryRequest(path, MinecraftRecoveryDetailSchema);
  if (current.intent.status !== "pending") return;
  await deliveryRequest(`${path}/fail`, z.unknown(), {
    message:
      "Original-source recovery failed; retain the failed deployment and application lock. Inspect the private request journal and use the independent restoration procedure if source selection was admitted.",
  });
}
