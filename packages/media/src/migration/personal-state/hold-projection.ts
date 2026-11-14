import type { Prisma } from "#generated/prisma/client.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { buildRecoveryClaims } from "#infrastructure/recovery/legacy-claims/projection.ts";
import { buildMovieRecoveryClaimsV3 } from "#infrastructure/recovery/legacy-claims/movie/projection.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import { BundleReportSchema } from "#shared/migration-handoff.ts";

/** Applied source reports remain authoritative when a historical import omitted
 * persisted requester records. A new ledger must not erase those missing rows. */
export async function personalHoldProjection(
  tx: Prisma.TransactionClient,
  hold: Prisma.RecoveryHoldGetPayload<{ include: { media: true } }>,
) {
  const budget = new PublicationAuthorityReadBudget();
  const plans = await tx.mediaHandoffPlan.findMany({
    where: {
      state: "applied",
      scope: { path: ["media"], array_contains: [{ mediaId: hold.mediaId }] },
    },
    include: { bundleReview: true },
    orderBy: { id: "asc" },
    take: budget.takeWeighted(2),
  });
  budget.consume(plans.length * 2);
  if (hold.media.kind !== "movie")
    return buildRecoveryClaims(tx, {
      mediaIds: [hold.mediaId],
      planIds: plans.map((plan) => plan.id),
    });
  return buildMovieRecoveryClaimsV3(
    tx,
    {
      scope: {
        rootMediaId: hold.mediaId,
        mediaId: hold.mediaId,
        edition: MovieEditionKeySchema.parse(hold.edition),
      },
      epoch: hold.recoveryEpoch,
      reports: plans.map((plan) =>
        BundleReportSchema.parse(plan.bundleReview.report),
      ),
    },
    budget,
  );
}
