import type { MediaActor } from "#application/auth.ts";
import type { Database } from "#infrastructure/database.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import { RemovalListSchema } from "#shared/api.ts";
import {
  artworkAncestrySelect,
  rootArtwork,
  rootMedia,
} from "#infrastructure/library/views/artwork.ts";

/** Removals still pending or recoverable: every one for an owner, a member's own titles otherwise. */
export async function readRemovalList(db: Database, actor: MediaActor) {
  const decisions = await db.retentionDecision.findMany({
    where: {
      edition: "default",
      state: { in: ["warning_pending", "grace_period", "quarantined"] },
      ...(actor.role === "owner"
        ? {}
        : {
            media: {
              requests: {
                some: { userId: actor.id, ...effectiveRequestWhere },
              },
            },
          }),
    },
    select: {
      id: true,
      mediaId: true,
      state: true,
      graceUntil: true,
      purgeAfter: true,
      media: {
        select: {
          title: true,
          kind: true,
          version: true,
          ...artworkAncestrySelect,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return RemovalListSchema.parse(
    decisions.map((decision) => ({
      ...decision,
      rootMediaId: rootMedia(decision.media).id,
      artwork: rootArtwork(decision.media),
    })),
  );
}
