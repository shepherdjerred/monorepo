import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";

export type Delivery = Prisma.NotificationDeliveryGetPayload<{
  include: { event: true; user: { include: { notificationPreference: true } } };
}>;

export function personalTarget(
  delivery: Delivery,
): { channel: "email" | "discord"; recipient: string } | null {
  const channel = z.enum(["email", "discord"]).parse(delivery.channel);
  const preference = delivery.user.notificationPreference;
  const recipient =
    channel === "email" ? delivery.user.email : delivery.user.discordId;
  const enabled =
    channel === "email"
      ? preference?.emailEnabled === true &&
        delivery.user.emailVerifiedAt !== null
      : preference?.discordEnabled === true;
  if (recipient === null || !enabled) return null;
  if (delivery.event.kind === "media_upgraded" && preference?.upgrades !== true)
    return null;
  return ["files_quarantined", "files_purged"].includes(delivery.event.kind) &&
    preference?.removalCompleted !== true
    ? null
    : { channel, recipient };
}
