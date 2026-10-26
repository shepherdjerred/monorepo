import { z } from "zod";
import { MinecraftRecoveryDetailSchema } from "@shepherdjerred/delivery/contract";
import { deliveryRequest } from "./client.ts";

export async function failMinecraftIntent(intentId: string) {
  const path = `minecraft-recovery/${encodeURIComponent(intentId)}`;
  const current = await deliveryRequest(path, MinecraftRecoveryDetailSchema);
  if (current.intent.status !== "pending") return;
  await deliveryRequest(`${path}/fail`, z.unknown(), {
    message:
      "Minecraft recovery was removed. The retained volume was not restored.",
  });
}
