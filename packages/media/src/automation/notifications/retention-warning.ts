import type { Prisma } from "#generated/prisma/client.ts";
import { queueOperation } from "#automation/store.ts";
import { captureRetentionPlexProjection } from "#infrastructure/plex-binding/retention.ts";
import type {
  PlexBindingSnapshot,
  PlexPhysicalGroup,
} from "#shared/plex-binding/contract.ts";

export async function createWarning(
  tx: Prisma.TransactionClient,
  item: {
    id: string;
    requests: Prisma.MediaRequestGetPayload<{
      include: { user: { include: { notificationPreference: true } } };
    }>[];
  },
  authority: {
    generation: number;
    epoch: number;
    binding: {
      groups: readonly PlexPhysicalGroup[];
      bindings: readonly PlexBindingSnapshot[];
    };
  },
) {
  const { generation, epoch, binding } = authority;
  const decisionId = crypto.randomUUID();
  await tx.retentionDecision.create({
    data: {
      id: decisionId,
      mediaId: item.id,
      generation,
      edition: "default",
      state: "eligible",
      evidence: { recoveryEpoch: epoch },
    },
  });
  await captureRetentionPlexProjection(tx, { decisionId, ...binding });
  const event = await tx.applicationEvent.create({
    data: {
      mediaId: item.id,
      kind: "retention_warning",
      payload: { decisionId, generation },
    },
  });
  const decision = await tx.retentionDecision.update({
    where: { id: decisionId },
    data: {
      state: "warning_pending",
      version: { increment: 1 },
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
