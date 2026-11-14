import type { Database } from "#infrastructure/database.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import { INTEREST_POLICY } from "#domain/household/interests.ts";
import { RequestInterestListSchema } from "#shared/household/interests.ts";

export async function listRequestInterests(
  db: Database,
  actor: MediaActor,
  cursor: string | null,
) {
  const currentActor = await db.mediaUser.findUnique({
    where: { id: actor.id },
  });
  if (currentActor === null)
    throw new MediaError("unauthenticated", "Sign in again", 401);
  const requests = await db.mediaRequest.findMany({
    where: {
      direct: true,
      ...(currentActor.role === "owner" && !currentActor.restricted
        ? {}
        : { userId: currentActor.id }),
      ...(cursor === null ? {} : { id: { gt: cursor } }),
    },
    include: { media: { select: { title: true } } },
    orderBy: { id: "asc" },
    take: 50,
  });
  const now = new Date();
  const eventIds = requests.flatMap((request) =>
    request.interestNoticeEventId === null
      ? []
      : [request.interestNoticeEventId],
  );
  const deliveries = await db.notificationDelivery.findMany({
    where: { eventId: { in: eventIds }, channel: { in: ["email", "discord"] } },
    take: 101,
  });
  if (deliveries.length > 100)
    throw new Error(
      "Request interest page has duplicate private delivery identities",
    );
  return RequestInterestListSchema.parse({
    items: requests.map((request) => ({
      requestId: request.id,
      mediaId: request.mediaId,
      edition: request.edition,
      userId: request.userId,
      title: request.media.title,
      keepingPolicy: request.keepingPolicy,
      interestState: request.interestState,
      version: request.version,
      interestRevision: request.interestRevision,
      renewedAt: request.interestRenewedAt.toISOString(),
      releasedAt: request.interestReleasedAt?.toISOString() ?? null,
      releaseReason: request.interestReleaseReason,
      noticeEventId: request.interestNoticeEventId,
      replyBy:
        request.interestNoticeAcceptedAt === null
          ? null
          : new Date(
              request.interestNoticeAcceptedAt.getTime() +
                INTEREST_POLICY.replyMs,
            ).toISOString(),
      ...noticeDeliveryStatus(request, deliveries, now),
    })),
    nextCursor: requests.length === 50 ? (requests.at(-1)?.id ?? null) : null,
  });
}

function noticeDeliveryStatus(
  request: {
    userId: string;
    interestNoticeEventId: string | null;
    interestNoticeRevision: number | null;
    interestRevision: number;
    interestNoticeViewedAt: Date | null;
  },
  deliveries: {
    userId: string;
    eventId: string;
    state: string;
    providerStatus: string | null;
    reconciledAt: Date | null;
    acceptedAt: Date | null;
  }[],
  now: Date,
) {
  if (
    request.interestNoticeEventId === null ||
    request.interestNoticeRevision !== request.interestRevision
  )
    return { noticeDeliveryState: null, noticeReason: null };
  if (
    request.interestNoticeViewedAt !== null &&
    request.interestNoticeViewedAt <= now
  )
    return { noticeDeliveryState: "accepted", noticeReason: null };
  const selected = deliveries.filter(
    (delivery) =>
      delivery.eventId === request.interestNoticeEventId &&
      delivery.userId === request.userId,
  );
  if (
    selected.some(
      (delivery) =>
        delivery.state === "accepted" &&
        delivery.providerStatus !== "bounced" &&
        delivery.acceptedAt !== null &&
        delivery.acceptedAt <= now &&
        delivery.reconciledAt !== null &&
        delivery.reconciledAt <= now &&
        now.getTime() - delivery.reconciledAt.getTime() <= 60_000,
    )
  )
    return { noticeDeliveryState: "accepted", noticeReason: null };
  if (
    selected.some(
      (delivery) =>
        delivery.state === "pending" || delivery.state === "sending",
    )
  )
    return {
      noticeDeliveryState: "pending",
      noticeReason: "private_notice_pending",
    };
  return {
    noticeDeliveryState: "attention",
    noticeReason:
      selected.length === 0
        ? "verified_private_channel_missing"
        : "private_notice_unconfirmed",
  };
}
