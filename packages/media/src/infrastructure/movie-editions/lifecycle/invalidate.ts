import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";

/** A new personal declaration invalidates only this cut's uncommitted policy timers. */
export async function invalidateMovieRetentionV4(
  tx: Prisma.TransactionClient,
  scope: MovieEditionScope,
) {
  await tx.retentionDecision.updateMany({
    where: {
      mediaId: scope.mediaId,
      edition: scope.edition,
      state: { in: ["eligible", "warning_pending", "grace_period"] },
    },
    data: { state: "cancelled", version: { increment: 1 } },
  });
}
