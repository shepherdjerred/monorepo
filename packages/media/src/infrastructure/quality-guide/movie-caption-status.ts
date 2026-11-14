import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { currentMovieSubtitlePolicies } from "#infrastructure/movie-editions/subtitle-policy.ts";
import { policyStatus } from "#infrastructure/subtitle-policy.ts";
import { householdCaptionRequirements } from "./captions.ts";

/** Presentation follows the exact edition's profile and caption acceptance;
 * this read grants no acquisition or filesystem permission. */
export async function movieCaptionStatus(
  tx: Prisma.TransactionClient,
  input: {
    profileId: string | null;
    originalLanguage: string | null;
    scope: MovieEditionScope;
    asset:
      | Prisma.LibraryAssetGetPayload<{ include: { subtitles: true } }>
      | undefined;
    epoch: number;
  },
  budget: PublicationAuthorityReadBudget,
) {
  if (input.asset === undefined) return null;
  const profile =
    input.profileId === null
      ? null
      : await tx.qualityProfile.findUniqueOrThrow({
          where: { id: input.profileId },
        });
  budget.consume(profile === null ? 0 : 1);
  const household = await householdCaptionRequirements(
    tx,
    profile,
    input.originalLanguage,
    budget,
  );
  const policies = await currentMovieSubtitlePolicies(tx, input.scope, budget);
  const status = policyStatus({
    policy: policies[0],
    household,
    asset: input.asset,
    epoch: input.epoch,
  });
  return status === null || input.asset.subtitles.length <= 100
    ? status
    : {
        ...status,
        satisfied: false,
        protectedReasons: [
          ...status.protectedReasons,
          "subtitle_inventory_requires_bounded_reconciliation",
        ],
      };
}
