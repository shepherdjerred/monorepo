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

/**
 * Which of these exact movies and episodes have a removal that can still be
 * stopped, in one query however many are asked about. The command check and
 * the context read both ask here, so what a member is offered and what they
 * may do cannot drift apart.
 */
export async function leavingSoonIds(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
): Promise<Set<string>> {
  const decisions = await tx.retentionDecision.findMany({
    where: { ...leavingSoonDecisionWhere, mediaId: { in: [...mediaIds] } },
    select: { mediaId: true },
  });
  return new Set(decisions.map((decision) => decision.mediaId));
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
  if (media === null || !reader.visible(media)) return false;
  const leaving = await leavingSoonIds(tx, [mediaId]);
  return leaving.has(mediaId);
}
