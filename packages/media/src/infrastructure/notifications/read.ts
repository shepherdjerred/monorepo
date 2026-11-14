import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import { lockDelivery } from "#automation/notifications/locks.ts";
import { deliveryAuthority } from "#automation/notifications/authority.ts";
import { retentionWarningCurrent } from "#automation/notifications/retention-warning.ts";
import { readMovieRetentionWarningV4 } from "#shared/movie-editions/retention-v4.ts";
import { lockCommandActor } from "#infrastructure/editions/command-actor.ts";
import { householdRetentionState } from "#infrastructure/request-interest/protection.ts";

const WarningSchema = z.object({
  decisionId: z.uuid(),
  generation: z.int().nonnegative(),
});

/** An explicit recipient acknowledgement records an actual view, not a provider receipt. */
export async function acknowledgeNotificationRead(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  id: string,
  expectedVersion: number,
) {
  const delivery = await lockDelivery(tx, id);
  const currentActor = await lockCommandActor(tx, actor);
  if (
    delivery.userId !== currentActor.id ||
    delivery.channel !== "in_app" ||
    delivery.event.kind !== "retention_warning"
  )
    throw new MediaError(
      "forbidden",
      "Only the recipient can acknowledge this in-app reminder",
      403,
    );
  if (delivery.version !== expectedVersion)
    throw new MediaError(
      "version_conflict",
      "The reminder changed; refresh before acknowledging it",
      409,
    );
  if ((await deliveryAuthority(tx, delivery)) !== null)
    throw new MediaError(
      "notice_obsolete",
      "This reminder no longer has current authority",
      409,
    );
  const warning = WarningSchema.parse(delivery.event.payload);
  const edition =
    readMovieRetentionWarningV4(delivery.event.payload)?.scope.edition ??
    "default";
  const decision = await tx.retentionDecision.findUniqueOrThrow({
    where: { id: warning.decisionId },
    include: { media: { include: { intents: true, holds: true } } },
  });
  const evidence = z
    .object({ warningEventId: z.uuid() })
    .parse(decision.evidence);
  const household = await householdRetentionState(
    tx,
    decision.mediaId,
    edition,
  );
  if (
    evidence.warningEventId !== delivery.eventId ||
    household.reason !== null ||
    !retentionWarningCurrent(decision, {
      mediaId: delivery.event.mediaId,
      edition,
      generation: warning.generation,
      epoch: delivery.recoveryEpoch,
    })
  )
    throw new MediaError(
      "notice_obsolete",
      "Your library protections changed; this reminder no longer applies",
      409,
    );
  if (delivery.state === "accepted" && delivery.providerStatus === "viewed")
    return { status: "completed" as const, version: delivery.version };
  if (delivery.state !== "pending")
    throw new MediaError(
      "notice_obsolete",
      "This reminder cannot be acknowledged",
      409,
    );
  const now = new Date();
  await tx.notificationDelivery.update({
    where: { id },
    data: {
      state: "accepted",
      acceptedAt: now,
      providerStatus: "viewed",
      version: { increment: 1 },
    },
  });
  await tx.applicationEvent.create({
    data: {
      actorId: currentActor.id,
      mediaId: decision.mediaId,
      kind: "notification_viewed",
      payload: {
        deliveryId: id,
        eventId: delivery.eventId,
        decisionId: decision.id,
        generation: warning.generation,
        recoveryEpoch: delivery.recoveryEpoch,
      },
    },
  });
  return { status: "completed" as const, version: delivery.version + 1 };
}
