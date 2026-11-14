import type { Prisma } from "#generated/prisma/client.ts";

/** Viewed in-app acceptance is an authenticated mutation. Provider acceptance
 * instead requires a fresh, non-bounced private receipt observation. */
export function removalNoticeAcceptance(now: Date) {
  return {
    state: "accepted",
    acceptedAt: { not: null, lte: now },
    OR: [
      { channel: "in_app", providerStatus: "viewed" },
      {
        channel: { in: ["email", "discord"] },
        OR: [{ providerStatus: null }, { providerStatus: { not: "bounced" } }],
        reconciledAt: { gte: new Date(now.getTime() - 60_000), lte: now },
      },
    ],
  } satisfies Prisma.NotificationDeliveryWhereInput;
}
