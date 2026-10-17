import type { Prisma } from "#generated/prisma/client.ts";
import { lockMedia } from "#infrastructure/locks.ts";
import { lockEffectiveRequests } from "#infrastructure/request-claims.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { deliveryInclude, eventMediaIds } from "./message.ts";
import { lockSubtitlePolicies } from "#infrastructure/subtitle-policy.ts";

/** Match Keep/unwatch and root-cancellation ordering before locking delivery authority. */
export async function lockDelivery(tx: Prisma.TransactionClient, id: string) {
  const snapshot = await tx.notificationDelivery.findUniqueOrThrow({
    where: { id },
    include: deliveryInclude,
  });
  const mediaIds = eventMediaIds(snapshot);
  await lockMedia(tx, mediaIds);
  await lockEffectiveRequests(tx, mediaIds);
  await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
  if (snapshot.event.kind === "subtitles_ready") await lockSubtitlePolicies(tx);
  await tx.$queryRaw`SELECT id FROM "MediaUser" WHERE id = ${snapshot.userId} FOR SHARE`;
  await tx.$queryRaw`SELECT "userId" FROM "NotificationPreference" WHERE "userId" = ${snapshot.userId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "NotificationDelivery" WHERE id = ${id} FOR UPDATE`;
  return await tx.notificationDelivery.findUniqueOrThrow({
    where: { id },
    include: deliveryInclude,
  });
}

export async function deliveryRuntimeActive(
  tx: Prisma.TransactionClient,
  epoch: number,
): Promise<boolean> {
  return await lockRuntimeAuthority(tx, epoch);
}
