import { z } from "zod";
import type { MediaAutomationContext } from "./context.ts";
import { queueOperation, serializable } from "./store.ts";
import { IntegrationError } from "#integrations/http.ts";
import { lockMedia } from "#infrastructure/locks.ts";

async function invalidateWatch(
  context: MediaAutomationContext,
  mediaId: string,
  userId?: string,
): Promise<void> {
  await serializable(context.db, async (tx) => {
    await lockMedia(tx, [mediaId]);
    await tx.watchState.deleteMany({
      where: { mediaId, ...(userId === undefined ? {} : { userId }) },
    });
  });
}

const PlexIdentitySchema = z.object({
  plexRatingKey: z.string().regex(/^\d+$/u).optional(),
  plexSectionId: z.string().optional(),
});
const CredentialSchema = z.object({ serverToken: z.string().min(1) });

/** Read current viewCount using each requester's scoped token; absence never means watched. */
export async function observeRequesterWatch(
  context: MediaAutomationContext,
  mediaId: string,
): Promise<{ complete: boolean; reason: string | null }> {
  const media = await context.db.mediaItem.findUniqueOrThrow({
    where: { id: mediaId },
    include: { requests: { where: { active: true }, include: { user: true } } },
  });
  const identity = PlexIdentitySchema.parse(media.externalIds);
  if (identity.plexRatingKey === undefined) {
    await invalidateWatch(context, mediaId);
    return { complete: false, reason: "plex_identity_missing" };
  }
  let complete = true;
  for (const request of media.requests) {
    if (request.user.role === "owner") continue;
    const credential = await context.db.credential.findUnique({
      where: { userId_kind: { userId: request.userId, kind: "plex" } },
    });
    if (credential === null) {
      await invalidateWatch(context, mediaId, request.userId);
      complete = false;
      continue;
    }
    const token = CredentialSchema.parse(
      JSON.parse(
        context.cipher.decrypt(
          credential.ciphertext,
          `plex:${request.user.plexAccountId}`,
        ),
      ),
    );
    try {
      const watched = await context
        .userPlex(token.serverToken)
        .watched(identity.plexRatingKey);
      await serializable(context.db, async (tx) => {
        await tx.$queryRaw`SELECT id FROM "MediaItem" WHERE id = ${mediaId} FOR UPDATE`;
        const prior = await tx.watchState.findUnique({
          where: { userId_mediaId: { userId: request.userId, mediaId } },
        });
        await tx.watchState.upsert({
          where: { userId_mediaId: { userId: request.userId, mediaId } },
          create: {
            userId: request.userId,
            mediaId,
            watched,
            observedAt: new Date(),
            source: "plex_current",
          },
          update: { watched, observedAt: new Date(), source: "plex_current" },
        });
        if (watched) return;
        const outstanding = await tx.retentionDecision.count({
          where: {
            mediaId,
            state: { in: ["eligible", "warning_pending", "grace_period"] },
          },
        });
        if (outstanding === 0 && prior?.watched !== true) return;
        await tx.mediaItem.update({
          where: { id: mediaId },
          data: { version: { increment: 1 } },
        });
        const intent = await tx.mediaIntent.update({
          where: { mediaId },
          data: { generation: { increment: 1 }, version: { increment: 1 } },
        });
        await tx.retentionDecision.updateMany({
          where: {
            mediaId,
            state: { in: ["eligible", "warning_pending", "grace_period"] },
          },
          data: { state: "cancelled", version: { increment: 1 } },
        });
        await tx.applicationEvent.create({
          data: {
            mediaId,
            actorId: request.userId,
            kind: "media_marked_unwatched",
            payload: { generation: intent.generation },
          },
        });
        if (media.availability === "quarantined")
          await queueOperation(tx, {
            key: `unwatched-restore:${mediaId}:${String(intent.generation)}`,
            kind: "restore_media",
            targetId: mediaId,
            payload: { mediaId, generation: intent.generation },
          });
      });
    } catch (error) {
      if (!(error instanceof IntegrationError)) throw error;
      await invalidateWatch(context, mediaId, request.userId);
      complete = false;
    }
  }
  return { complete, reason: complete ? null : "requester_watch_unknown" };
}

export async function queueRetentionCheck(
  context: MediaAutomationContext,
  mediaId: string,
  bucket: string,
): Promise<void> {
  const intent = await context.db.mediaIntent.findUnique({
    where: { mediaId },
  });
  if (intent === null) return;
  await serializable(context.db, async (tx) => {
    await queueOperation(tx, {
      key: `retention:${mediaId}:${String(intent.generation)}:${bucket}`,
      kind: "retain_media",
      targetId: mediaId,
      payload: { mediaId, generation: intent.generation },
    });
  });
}

export { PlexIdentitySchema };
