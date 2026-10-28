import type { Prisma, RetentionDecision } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { FileGuardError } from "#automation/files/types.ts";
import {
  hasPendingLegacyClaims,
  LEGACY_CLAIM_PROTECTION,
} from "#infrastructure/recovery/legacy-claims/protection.ts";

export async function assertMovieQuarantineLegacyClaims(
  tx: Prisma.TransactionClient,
  mediaId: string,
) {
  if (await hasPendingLegacyClaims(tx, [mediaId]))
    throw new FileGuardError(LEGACY_CLAIM_PROTECTION);
}

export function movieRetentionInclude(edition: string) {
  return {
    intents: { where: { edition } },
    holds: { where: { edition } },
    recoveryHolds: { where: { edition, releasedAt: null } },
    acquisitionReservations: { where: { edition } },
    requests: {
      where: { edition, active: true, excluded: false, direct: true },
      include: { user: true },
      orderBy: { id: "asc" },
    },
  } satisfies Prisma.MediaItemInclude;
}

export function assertMovieQuarantineState(input: {
  decision: RetentionDecision;
  scope: MovieEditionScope;
  item: Prisma.MediaItemGetPayload<{
    include: ReturnType<typeof movieRetentionInclude>;
  }>;
  generation: number | undefined;
  epoch: number;
  purge?: boolean | undefined;
}) {
  const { decision, scope, item } = input;
  const target = item.intents[0];
  if (
    decision.state !==
      (input.purge === true ? "quarantined" : "grace_period") ||
    decision.edition !== scope.edition ||
    decision.mediaId !== scope.mediaId ||
    target?.generation !== decision.generation ||
    target.generation !== input.generation ||
    target.automationEpoch !== input.epoch ||
    item.recoveryHolds.length > 0 ||
    item.acquisitionReservations.length > 0
  )
    throw new FileGuardError("decision_obsolete");
  return target;
}

export function movieRetentionAssetVersion(version: number, purge?: boolean) {
  return version + (purge === true ? 1 : 0);
}
