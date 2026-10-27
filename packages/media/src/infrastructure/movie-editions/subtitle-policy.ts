import type { Prisma } from "#generated/prisma/client.ts";
import {
  MovieEditionScopeSchema,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import { SubtitlePolicySchema } from "#shared/subtitle-policy.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

/** A movie edition inherits the household movie policy only when it has no override. */
export async function currentMovieSubtitlePolicies(
  tx: Prisma.TransactionClient,
  raw: MovieEditionScope,
  budget?: PublicationAuthorityReadBudget,
) {
  const scope = MovieEditionScopeSchema.parse(raw);
  const latest = (edition: string) =>
    tx.mediaSubtitlePolicyVersion.findFirst({
      where: { mediaId: scope.mediaId, edition },
      orderBy: { version: "desc" },
    });
  const override = await latest(scope.edition);
  const policy =
    override ?? (scope.edition === "default" ? null : await latest("default"));
  budget?.consume(policy === null ? 0 : 1);
  return policy === null
    ? []
    : [
        {
          mediaId: scope.mediaId,
          edition: policy.edition,
          id: policy.id,
          version: policy.version,
          recoveryEpoch: policy.recoveryEpoch,
          rules: SubtitlePolicySchema.parse(policy.rules),
        },
      ];
}
