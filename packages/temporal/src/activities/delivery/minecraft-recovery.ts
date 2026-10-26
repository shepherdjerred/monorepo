import { ApplicationFailure } from "@temporalio/common";

/** Open recovery workflows fail closed. This does not restore a volume. */
export function recoverDeliveryMinecraft(_intentId: string): Promise<void> {
  throw ApplicationFailure.nonRetryable(
    "Minecraft recovery was removed. Releases restart the retained volume. Scheduled Velero backups are the only backup.",
    "MinecraftRecoveryRemoved",
  );
}

export async function failDeliveryMinecraftRecovery(
  intentId: string,
): Promise<void> {
  const { failMinecraftIntent } =
    await import("#lib/delivery/minecraft-recovery.ts");
  await failMinecraftIntent(intentId);
}
