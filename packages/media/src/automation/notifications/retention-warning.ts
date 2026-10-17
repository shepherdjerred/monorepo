import type { Prisma } from "#generated/prisma/client.ts";
import { queueOperation } from "#automation/store.ts";

export async function createWarning(
  tx: Prisma.TransactionClient,
  item: {
    id: string;
    requests: Prisma.MediaRequestGetPayload<{
      include: { user: { include: { notificationPreference: true } } };
    }>[];
  },
  generation: number,
  epoch: number,
) {
  const decisionId = crypto.randomUUID();
  const event = await tx.applicationEvent.create({
    data: {
      mediaId: item.id,
      kind: "retention_warning",
      payload: { decisionId, generation },
    },
  });
  const decision = await tx.retentionDecision.create({
    data: {
      id: decisionId,
      mediaId: item.id,
      generation,
      edition: "default",
      state: "warning_pending",
      evidence: { warningEventId: event.id, recoveryEpoch: epoch },
    },
  });
  for (const claim of item.requests.filter(
    (request) => request.user.role !== "owner",
  )) {
    const preference = claim.user.notificationPreference;
    const channels = [
      preference?.emailEnabled === true &&
      claim.user.emailVerifiedAt !== null &&
      claim.user.email !== null
        ? "email"
        : null,
      preference?.discordEnabled === true && claim.user.discordId !== null
        ? "discord"
        : null,
    ].filter((channel) => channel !== null);
    for (const channel of channels) {
      const notification = await tx.notificationDelivery.create({
        data: {
          eventId: event.id,
          userId: claim.userId,
          channel,
          state: "pending",
          recoveryEpoch: epoch,
        },
      });
      await queueOperation(tx, {
        key: `notification:${notification.id}`,
        kind: "deliver_notification",
        targetId: notification.id,
        userId: claim.userId,
        payload: { notificationId: notification.id },
      });
    }
  }
  return decision;
}
