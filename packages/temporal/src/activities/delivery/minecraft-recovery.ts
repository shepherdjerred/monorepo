import { Context } from "@temporalio/activity";
import {
  recoverMinecraftIntent,
  failMinecraftIntent,
} from "#lib/delivery/minecraft-recovery.ts";
import { withBackupActivityHeartbeat } from "#activities/homelab/seaweedfs-backup-heartbeat.ts";

/** Cleanup reopens only the original; the API independently proves final settlement. */
export async function recoverDeliveryMinecraft(
  intentId: string,
): Promise<void> {
  await withBackupActivityHeartbeat(
    Context.current(),
    async ({ signal }) => {
      await recoverMinecraftIntent(intentId, { signal });
    },
    { stage: "minecraft-recovery" },
  );
}

export async function failDeliveryMinecraftRecovery(
  intentId: string,
): Promise<void> {
  await failMinecraftIntent(intentId);
}
