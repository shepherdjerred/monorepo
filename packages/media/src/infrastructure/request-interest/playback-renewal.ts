import type { MediaRequest, Prisma } from "#generated/prisma/client.ts";
import { renewedInterest } from "./policy.ts";

type Claim = Pick<
  MediaRequest,
  | "active"
  | "direct"
  | "excluded"
  | "keepingPolicy"
  | "interestState"
  | "interestReleaseReason"
  | "interestReleasedAt"
  | "lastMeaningfulProgressAt"
  | "interestRenewedAt"
>;

export function automaticallyExpired(request: Claim) {
  return (
    request.active &&
    request.direct &&
    !request.excluded &&
    request.keepingPolicy === "temporary" &&
    request.interestState === "expired" &&
    request.interestReleaseReason === "lost_interest" &&
    request.interestReleasedAt !== null
  );
}

/** Every native interest transition advances the same target and media CAS fences. */
export async function advanceInterestScope(
  tx: Prisma.TransactionClient,
  request: Pick<MediaRequest, "mediaId" | "edition">,
) {
  const target = await tx.mediaIntent.update({
    where: {
      mediaId_edition: { mediaId: request.mediaId, edition: request.edition },
    },
    data: { generation: { increment: 1 }, version: { increment: 1 } },
  });
  await tx.mediaItem.update({
    where: { id: request.mediaId },
    data: { version: { increment: 1 } },
  });
  return target;
}

export function resumesExpiredInterest(
  request: Claim,
  progressAt: number | null,
) {
  return (
    automaticallyExpired(request) &&
    progressAt !== null &&
    progressAt >
      Math.max(
        request.interestReleasedAt?.getTime() ?? Infinity,
        request.lastMeaningfulProgressAt?.getTime() ?? 0,
        request.interestRenewedAt.getTime(),
      )
  );
}

/** Caller holds the scope/request locks and has validated native current-serving facts. */
export async function renewExpiredInterest(
  tx: Prisma.TransactionClient,
  request: MediaRequest,
  progressAt: number | null,
  now: Date,
) {
  if (progressAt === null || !resumesExpiredInterest(request, progressAt))
    return false;
  await tx.$queryRaw`SELECT id FROM "MediaUser" WHERE id=${request.userId} FOR SHARE`;
  const user = await tx.mediaUser.findUniqueOrThrow({
    where: { id: request.userId },
  });
  if (user.restricted) return false;
  const changed = await tx.mediaRequest.update({
    where: { id: request.id },
    data: {
      ...renewedInterest(now),
      lastMeaningfulProgressAt: new Date(progressAt),
      interestRevision: { increment: 1 },
      version: { increment: 1 },
    },
  });
  await advanceInterestScope(tx, request);
  await tx.retentionDecision.updateMany({
    where: {
      edition: request.edition,
      OR: [
        { mediaId: request.mediaId },
        {
          media: {
            requests: {
              some: {
                userId: request.userId,
                edition: request.edition,
                active: true,
                excluded: false,
                coverageSources: {
                  some: {
                    rootRequestId: request.id,
                    active: true,
                    edition: request.edition,
                  },
                },
              },
            },
          },
        },
      ],
      state: { in: ["eligible", "warning_pending", "grace_period"] },
    },
    data: { state: "cancelled", version: { increment: 1 } },
  });
  await tx.applicationEvent.create({
    data: {
      mediaId: request.mediaId,
      kind: "request_interest_playback_renewed",
      payload: {
        requestId: request.id,
        userId: request.userId,
        interestRevision: changed.interestRevision,
        progressAt: new Date(progressAt).toISOString(),
        previousReleasedAt: request.interestReleasedAt?.toISOString() ?? null,
      },
    },
  });
  return true;
}
