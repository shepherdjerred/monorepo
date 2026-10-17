import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import type { MediaAction } from "#shared/contract.ts";

export async function validateAction(
  db: Prisma.TransactionClient,
  actor: MediaActor,
  mediaId: string,
  input: MediaAction,
): Promise<void> {
  const media = await db.mediaItem.findUnique({ where: { id: mediaId } });
  if (media === null)
    throw new MediaError("media_not_found", "Media item does not exist", 404);
  if (actor.role !== "owner") {
    const claim = await db.mediaRequest.findUnique({
      where: { userId_mediaId: { userId: actor.id, mediaId } },
    });
    if (claim?.active !== true)
      throw new MediaError(
        "request_required",
        "An active request is required for this action",
        403,
      );
  }
  if (input.action === "restore" && media.availability !== "quarantined")
    throw new MediaError(
      "not_quarantined",
      "Only quarantined media can be restored",
      409,
    );
  if (input.action === "select_release") {
    const release = await db.releaseCandidate.findUnique({
      where: { id: input.releaseId },
    });
    if (release?.mediaIds.includes(mediaId) !== true)
      throw new MediaError(
        "invalid_release",
        "Release does not cover this media item",
        422,
      );
  }
}

export async function applyHold(
  db: Prisma.TransactionClient,
  actor: MediaActor,
  mediaId: string,
  options: { action: MediaAction["action"]; keepDays: number },
): Promise<void> {
  if (options.action === "unpin") {
    await db.retentionHold.deleteMany({
      where: { userId: actor.id, mediaId, isPin: true },
    });
    return;
  }
  if (options.action !== "keep" && options.action !== "pin") return;
  const previous = await db.retentionHold.findUnique({
    where: { userId_mediaId: { userId: actor.id, mediaId } },
  });
  const until = new Date(Date.now() + options.keepDays * 86_400_000);
  const isPin = options.action === "pin" || previous?.isPin === true;
  const previousUntil = previous?.until;
  const effectiveUntil =
    previousUntil !== undefined &&
    previousUntil !== null &&
    previousUntil > until
      ? previousUntil
      : until;
  await db.retentionHold.upsert({
    where: { userId_mediaId: { userId: actor.id, mediaId } },
    create: { userId: actor.id, mediaId, isPin, until: isPin ? null : until },
    update: { isPin, until: isPin ? null : effectiveUntil },
  });
}

export function actionIntentChange(action: MediaAction["action"]) {
  if (action === "remove")
    return {
      desiredPresence: false,
      monitoring: false,
      intentionallyRemovedAt: new Date(),
    };
  return action === "restore"
    ? { desiredPresence: true, monitoring: true, intentionallyRemovedAt: null }
    : {};
}

export function actionCommand(action: MediaAction["action"]): string {
  if (action === "remove") return "retain_media";
  if (action === "restore") return "restore_media";
  return action === "select_release" ? "acquire_release" : "reconcile_media";
}

export async function sponsorClaim(
  db: Prisma.TransactionClient,
  userId: string,
  requestId: string,
  input: { mediaId: string; subtitleLanguages: string[] },
): Promise<void> {
  const existing = await db.mediaRequest.findUnique({
    where: { userId_mediaId: { userId, mediaId: input.mediaId } },
  });
  if (existing?.active === true) return;
  await db.mediaRequest.upsert({
    where: { userId_mediaId: { userId, mediaId: input.mediaId } },
    create: { userId, ...input, sponsorRequestId: requestId },
    update: {
      active: true,
      subtitleLanguages: input.subtitleLanguages,
      sponsorRequestId: requestId,
      version: { increment: 1 },
    },
  });
}

export async function invalidateRetention(
  db: Prisma.TransactionClient,
  mediaId: string,
): Promise<void> {
  await db.retentionDecision.updateMany({
    where: {
      mediaId,
      state: { in: ["eligible", "warning_pending", "grace_period"] },
    },
    data: { state: "cancelled", version: { increment: 1 } },
  });
}
