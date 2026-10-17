import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { queueLifecycleNotifications } from "./events.ts";

export async function queueIntervention(
  tx: Prisma.TransactionClient,
  operationId: string,
): Promise<void> {
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: operationId },
  });
  if (
    operation.kind === "deliver_notification" ||
    operation.kind.startsWith("plex_exclusion_")
  )
    return;
  const attempt = await tx.acquisitionAttempt.findFirst({
    where: { OR: [{ operationId }, { coordinatorOperationId: operationId }] },
  });
  const birth = z
    .object({
      recoveryEpoch: z.number().int().optional(),
      mediaId: z.string().optional(),
    })
    .parse(operation.payload);
  const epoch = attempt?.recoveryEpoch ?? birth.recoveryEpoch ?? -1;
  const ids =
    attempt?.mediaIds ?? (birth.mediaId === undefined ? [] : [birth.mediaId]);
  const intents = await tx.mediaIntent.findMany({
    where: { mediaId: { in: ids } },
  });
  const items = intents.map((intent) => ({
    mediaId: intent.mediaId,
    generation: intent.generation,
  }));
  if (
    items.length > 0 &&
    [
      "reconcile_media",
      "acquire_release",
      "acquire_subtitles",
      "install_subtitle",
    ].includes(operation.kind)
  )
    await queueLifecycleNotifications(tx, {
      key: `intervention:${operationId}`,
      kind: "acquisition_failed",
      epoch,
      items,
      operationId,
    });
  await queueLifecycleNotifications(tx, {
    key: `owner-intervention:${operationId}`,
    kind: "system_intervention",
    epoch,
    items,
    ownerOnly: true,
    operationId,
  });
}
