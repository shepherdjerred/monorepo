import type { Prisma } from "#generated/prisma/client.ts";
import { assertDefaultEdition } from "#shared/editions/scope.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { ItemSchema } from "./message.ts";
import { queueDelivery } from "./events.ts";

export async function queueSharedPublication(
  tx: Prisma.TransactionClient,
  attemptId: string,
  settings: Awaited<
    ReturnType<NonNullable<MediaAutomationContext["sharedAnnouncements"]>>
  >,
): Promise<void> {
  if (!settings.enabled || !settings.available || settings.channelId === "")
    return;
  const owner = await tx.mediaUser.findFirst({
    where: { role: "owner" },
    orderBy: { id: "asc" },
  });
  if (owner === null) throw new Error("Shared announcement owner missing");
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  assertDefaultEdition(attempt.edition);
  for (const kind of ["media_available", "media_upgraded"] as const) {
    if (kind === "media_upgraded" && !settings.upgrades) continue;
    const events = await tx.applicationEvent.findMany({
      where: {
        dedupeKey: { startsWith: `publication:${attemptId}:${kind}:item:` },
      },
      orderBy: { mediaId: "asc" },
    });
    const items = events.map((event) => ItemSchema.parse(event.payload));
    for (let offset = 0; offset < items.length; offset += 1000) {
      const key = `shared:${attemptId}:${kind}:${String(offset)}`;
      const chunk = items.slice(offset, offset + 1000);
      const event = await tx.applicationEvent.upsert({
        where: { dedupeKey: key },
        create: {
          dedupeKey: key,
          kind,
          payload: {
            items: chunk,
            ownerOnly: true,
            recoveryEpoch: attempt.recoveryEpoch,
            channelId: settings.channelId,
          },
        },
        update: {},
      });
      const delivery = await tx.notificationDelivery.upsert({
        where: {
          eventId_userId_channel: {
            eventId: event.id,
            userId: owner.id,
            channel: "discord_shared",
          },
        },
        create: {
          eventId: event.id,
          userId: owner.id,
          channel: "discord_shared",
          state: "pending",
          recoveryEpoch: attempt.recoveryEpoch,
        },
        update: {},
      });
      await queueDelivery(
        tx,
        delivery.id,
        owner.id,
        `notification:${delivery.id}`,
      );
    }
  }
}
