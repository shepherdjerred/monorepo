import { ApplicationFailure } from "@temporalio/common";
import type { DeploymentDetail } from "@shepherdjerred/delivery/contract";

/** Retained-volume releases do not wait on a preservation controller. */
export function prepareMinecraftDelivery(_detail: DeploymentDetail) {
  return { status: "ready" } as const;
}

/**
 * Open histories may still schedule this activity. It never takes a backup
 * or restores a volume.
 */
export function preserveDeliveryMinecraft(_id: string): Promise<{
  status: "ready" | "waiting";
}> {
  throw ApplicationFailure.nonRetryable(
    "Minecraft preservation was removed. Releases restart the retained volume. Scheduled Velero backups are the only backup.",
    "MinecraftPreservationRemoved",
  );
}
