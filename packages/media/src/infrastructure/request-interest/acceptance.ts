import type { MediaRequest, Prisma } from "#generated/prisma/client.ts";
import { currentInterestNotice } from "./notice-identity.ts";

/** Acceptance belongs to this exact requester, scope and interest revision. */
export async function noticeAcceptance(
  tx: Prisma.TransactionClient,
  request: MediaRequest,
  now: Date,
): Promise<Date | null> {
  if (
    request.interestNoticeEventId === null ||
    request.interestNoticeRevision !== request.interestRevision
  )
    return null;
  const event = await tx.applicationEvent.findUnique({
    where: { id: request.interestNoticeEventId },
  });
  const noticeEvent = currentInterestNotice(request, event);
  if (noticeEvent === null) return null;
  if (
    request.interestNoticeViewedAt !== null &&
    request.interestNoticeViewedAt >= noticeEvent.createdAt &&
    request.interestNoticeViewedAt <= now
  )
    return request.interestNoticeViewedAt;
  const accepted = await tx.notificationDelivery.findFirst({
    where: {
      eventId: noticeEvent.id,
      userId: request.userId,
      state: "accepted",
      channel: { in: ["email", "discord"] },
      acceptedAt: { not: null, gte: noticeEvent.createdAt, lte: now },
      reconciledAt: { gte: new Date(now.getTime() - 60_000), lte: now },
      OR: [{ providerStatus: null }, { providerStatus: { not: "bounced" } }],
    },
    orderBy: { acceptedAt: "asc" },
  });
  return accepted?.acceptedAt ?? null;
}
