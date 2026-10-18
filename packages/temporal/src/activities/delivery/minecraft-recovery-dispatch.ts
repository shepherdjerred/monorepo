import { dispatchRecoveryIntents } from "./workers/worker-recovery-dispatch.ts";

/** Recovery dispatch continues while ordinary deployment admission is paused. */
export async function dispatchDeliveryMinecraftRecoveries(): Promise<void> {
  await dispatchRecoveryIntents({
    path: "minecraft-recovery",
    workflowType: "deliveryMinecraftRecoveryWorkflow",
  });
}
