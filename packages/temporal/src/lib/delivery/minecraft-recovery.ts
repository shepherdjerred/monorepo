import { z } from "zod";
import { MinecraftRecoveryDetailSchema } from "@shepherdjerred/delivery/contract";
import { deliveryRequest } from "./client.ts";

/** Recovery no longer restores a volume. Callers fail the intent instead. */
export function recoverMinecraftIntent(
  _intentId: string,
  _options: { signal?: AbortSignal; controllerOrigin?: string } = {},
): never {
  throw new Error(
    "Minecraft recovery was removed. Releases restart the retained volume. Scheduled Velero backups are the only backup.",
  );
}

export async function failMinecraftIntent(intentId: string) {
  const path = `minecraft-recovery/${encodeURIComponent(intentId)}`;
  const current = await deliveryRequest(path, MinecraftRecoveryDetailSchema);
  if (current.intent.status !== "pending") return;
  await deliveryRequest(`${path}/fail`, z.unknown(), {
    message:
      "Minecraft recovery was removed. The retained volume was not restored.",
  });
}
