import type { Prisma } from "#generated/prisma/client.ts";
import type {
  PlexBindingFreshness,
  PlexBindingScope,
} from "#shared/plex-binding/contract.ts";

/** Derived observations cannot survive a changed association for this exact cut. */
export async function invalidateMoviePlexConsequences(
  tx: Prisma.TransactionClient,
  scope: PlexBindingScope,
  freshness: PlexBindingFreshness,
) {
  const target = { mediaId: scope.mediaId, edition: scope.edition };
  await tx.plexWatchProjection.deleteMany({ where: target });
  freshness.assertActive();
  await tx.watchState.deleteMany({ where: target });
  freshness.assertActive();
  await tx.retentionDecision.updateMany({
    where: {
      ...target,
      state: { in: ["eligible", "warning_pending", "grace_period"] },
    },
    data: { state: "cancelled", version: { increment: 1 } },
  });
  freshness.assertActive();
}
