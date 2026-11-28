import { z } from "zod";
import type { OperationStatus, Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { MovieDiscoveryStatus } from "#shared/movie-editions/lifecycle/public-v4.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

type DiscoveryScope = {
  scope: MovieEditionScope;
  generation: number;
  epoch: number;
};

/** Only a dispatched coordinator for this exact edition can describe discovery. */
export async function readMovieDiscoveryStatus(
  tx: Pick<Prisma.TransactionClient, "operation">,
  input: DiscoveryScope & { reserved: boolean },
  budget: PublicationAuthorityReadBudget,
) {
  const operation = await tx.operation.findFirst({
    where: movieDiscoveryWhere(input),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { status: true, payload: true, result: true },
  });
  if (operation === null) return;
  budget.consume(1);
  return movieDiscoveryOutcome(operation, input.reserved);
}

export function movieDiscoveryWhere({
  scope,
  generation,
  epoch,
}: DiscoveryScope): Prisma.OperationWhereInput {
  return {
    kind: "reconcile_movie_edition_v4",
    targetId: scope.mediaId,
    outbox: { is: { dispatchedAt: { not: null } } },
    AND: [
      { payload: { path: ["schemaVersion"], equals: 4 } },
      {
        payload: { path: ["scope", "rootMediaId"], equals: scope.rootMediaId },
      },
      { payload: { path: ["scope", "mediaId"], equals: scope.mediaId } },
      { payload: { path: ["scope", "edition"], equals: scope.edition } },
      { payload: { path: ["generation"], equals: generation } },
      { payload: { path: ["recoveryEpoch"], equals: epoch } },
    ],
  };
}

const CoordinatorKind = z.object({
  releaseId: z.uuid().optional(),
  movieRetryV1: z.object({}).optional(),
  movieRetryV2: z.object({}).optional(),
  movieRetryPlexAckV1: z.object({}).optional(),
});
const RecordedOutcome = z.object({ reason: z.string().nullish() }).nullable();

export function movieDiscoveryOutcome(
  operation: { status: OperationStatus; payload: unknown; result: unknown },
  reserved: boolean,
): MovieDiscoveryStatus | undefined {
  const kind = CoordinatorKind.parse(operation.payload);
  const retry =
    kind.movieRetryV1 !== undefined ||
    kind.movieRetryV2 !== undefined ||
    kind.movieRetryPlexAckV1 !== undefined;
  const pending =
    operation.status === "queued" || operation.status === "running";
  if (pending && retry) return "retrying";
  // A manual selection or an existing transfer is not an automatic search.
  if (reserved || kind.releaseId !== undefined) return undefined;
  if (pending) return "searching";
  const result = RecordedOutcome.parse(operation.result);
  if (
    operation.status === "completed" &&
    result?.reason === "no_acceptable_release"
  )
    return "waiting_for_release";
  if (operation.status !== "reconciling") return undefined;
  switch (result?.reason) {
    case "plex_exclusion_proof_required":
    case "acquisition_disabled":
    case "external_library_protected": {
      return result.reason;
    }
    case null:
    case undefined:
    default: {
      return undefined;
    }
  }
}
