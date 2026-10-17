import type { Prisma } from "#generated/prisma/client.ts";
import {
  AuthorityRevocationSchema,
  ownerHealthKey,
} from "#shared/notification-authority.ts";
import { queueDelivery } from "#automation/notifications/events.ts";
import type { z } from "zod";

/** The caller holds runtime FOR UPDATE and passes the actual resulting transition. */
export async function queueOwnerHealth(
  tx: Prisma.TransactionClient,
  input: z.infer<typeof AuthorityRevocationSchema>,
): Promise<void> {
  const proof = AuthorityRevocationSchema.parse(input);
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  if (
    runtime.mode !== "observe" ||
    runtime.ownershipConfirmed ||
    runtime.recoveryEpoch !== proof.recoveryEpoch ||
    runtime.version !== proof.runtimeVersion
  )
    throw new Error(
      "Owner health requires the exact committed revocation transition",
    );
  const key = ownerHealthKey(proof);
  const source = await tx.applicationEvent.upsert({
    where: { dedupeKey: `${key}:source` },
    create: { dedupeKey: `${key}:source`, kind: proof.reason, payload: proof },
    update: {},
  });
  const event = await tx.applicationEvent.upsert({
    where: { dedupeKey: key },
    create: {
      dedupeKey: key,
      kind: "owner_health",
      payload: { ...proof, sourceEventId: source.id },
    },
    update: {},
  });
  const owners = await tx.mediaUser.findMany({
    where: { role: "owner" },
    include: { notificationPreference: true },
    orderBy: { id: "asc" },
  });
  let recipients = 0;
  for (const owner of owners) {
    const preference = owner.notificationPreference;
    const channels = owner.restricted
      ? []
      : [
          preference?.emailEnabled === true &&
          owner.email !== null &&
          owner.emailVerifiedAt !== null
            ? "email"
            : null,
          preference?.discordEnabled === true && owner.discordId !== null
            ? "discord"
            : null,
        ].filter((channel) => channel !== null);
    for (const channel of channels) {
      const delivery = await tx.notificationDelivery.upsert({
        where: {
          eventId_userId_channel: {
            eventId: event.id,
            userId: owner.id,
            channel,
          },
        },
        create: {
          eventId: event.id,
          userId: owner.id,
          channel,
          state: "pending",
          recoveryEpoch: proof.recoveryEpoch,
        },
        update: {},
      });
      await queueDelivery(
        tx,
        delivery.id,
        owner.id,
        `notification:${delivery.id}`,
      );
      recipients++;
    }
  }
  if (recipients === 0)
    await tx.applicationEvent.upsert({
      where: { dedupeKey: `${key}:unavailable` },
      create: {
        dedupeKey: `${key}:unavailable`,
        kind: "owner_health_delivery_unavailable",
        payload: {
          ownerHealthEventId: event.id,
          reason: "no_eligible_personal_channels",
        },
      },
      update: {},
    });
}
