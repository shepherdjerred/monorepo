import type { MediaActor } from "#application/auth.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  assessVisibilityAccess,
  visibilityAncestry,
  type VisibilitySections,
} from "#infrastructure/visibility/access.ts";
import { leavingSoonDecisionWhere } from "#infrastructure/library/views/leaving.ts";

export type LeavingHoldSettings = {
  serverMachineId?: string | undefined;
  sections?: Partial<VisibilitySections> | undefined;
};

/** Whether this exact movie or episode has a removal that can still be stopped. */
export async function isLeavingSoon(
  tx: Prisma.TransactionClient,
  mediaId: string,
): Promise<boolean> {
  return (
    (await tx.retentionDecision.count({
      where: { ...leavingSoonDecisionWhere, mediaId },
    })) > 0
  );
}

/**
 * Household policy: a title that is leaving soon may be kept for 30 days by
 * any member who can see it in their Plex libraries, not only by those who
 * asked for it.
 *
 * It widens the hold and nothing else. The removal must be open on this exact
 * item, because placing the hold cancels that removal and the next one starts
 * again from a fresh notice. A quarantined title is not leaving soon: keeping
 * it would restore its files, and restoring stays with the owner and the
 * members following the title. A member whose Plex access is stale or does not
 * cover the title's library gets no hold, the same rule that hides the title
 * from their Leaving soon list.
 *
 * The caller holds the media, target and request locks, and the actor's row.
 */
export async function mayHoldLeavingTitle(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  mediaId: string,
  settings: LeavingHoldSettings,
): Promise<boolean> {
  const { reader } = await assessVisibilityAccess(tx, actor, settings);
  if (reader === null) return false;
  const media = await tx.mediaItem.findUnique({
    where: { id: mediaId },
    include: visibilityAncestry,
  });
  return (
    media !== null &&
    reader.visible(media) &&
    (await isLeavingSoon(tx, mediaId))
  );
}
