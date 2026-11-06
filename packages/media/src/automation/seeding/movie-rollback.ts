import { z } from "zod";
import type { Prisma, Operation } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { MovieSourceCohort } from "./movie-types.ts";
import { MovieRollbackInvocationV1Schema } from "#shared/movie-editions/rollback/operation.ts";
import { readMovieRollbackPlexV1 } from "#infrastructure/movie-editions/rollback/records.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { movieCaptionLibraryTargetV1 } from "./movie-library-work.ts";

type Completion = NonNullable<
  Awaited<ReturnType<typeof readMovieRollbackPlexV1>>
>;

/** A rejected acquisition keeps its original imported/completed state. Only its
 * actual closed inverse plus original-item serving receipt settles source use. */
export async function movieRolledBackSourceCompletionsV1(
  tx: Prisma.TransactionClient,
  torrent: MovieSourceCohort,
  scope: MovieEditionScope,
  budget: PublicationAuthorityReadBudget,
) {
  const completions = new Map<string, Completion>();
  if (
    !torrent.attempts.some((attempt) => attempt.state === "imported") &&
    !torrent.assets.some((asset) => asset.state === "rejected")
  )
    return completions;
  const rows = await tx.operation.findMany({
    where: {
      AND: [
        {
          result: {
            path: ["movieRollbackIntentV1", "intent", "scope"],
            equals: scope,
          },
        },
        {
          OR: torrent.attempts.map((attempt) => ({
            result: {
              path: [
                "movieRollbackPlexV1",
                "receipt",
                "invocation",
                "source",
                "attemptId",
              ],
              equals: attempt.id,
            },
          })),
        },
      ],
    },
    orderBy: { id: "asc" },
    take: budget.take,
  });
  budget.consume(rows.length);
  for (const operation of rows) {
    const invocation = z
      .object({
        movieRollbackIntentV1: z.object({
          intent: z.object({ invocation: MovieRollbackInvocationV1Schema }),
        }),
      })
      .parse(operation.result).movieRollbackIntentV1.intent.invocation;
    const completed = await readMovieRollbackPlexV1(tx, invocation, budget);
    const member = torrent.attempts.find(
      (attempt) => attempt.id === invocation.source.attemptId,
    );
    if (
      completed === null ||
      member?.torrentId !== torrent.id ||
      member.recoveryEpoch !== torrent.ownershipEpoch ||
      completed.intent.authority.recoveryEpoch !== torrent.ownershipEpoch ||
      identityHash(completed.intent.scope) !== identityHash(scope) ||
      completions.has(member.id)
    )
      throw new Error(
        "Movie source rollback completion has unknown or competing actual participants",
      );
    completions.set(member.id, completed);
  }
  return completions;
}

export function movieRetainedRollbackAssetV1(
  asset: MovieSourceCohort["assets"][number],
  completions: ReadonlyMap<string, Completion>,
) {
  const parents = [...completions.values()].filter(
    (parent) => parent.receipt.successor.id === asset.id,
  );
  if (parents.length !== 1) return false;
  const expected = parents[0]?.receipt.successor;
  if (expected === undefined)
    throw new Error("Movie retained source parent disappeared");
  if (!asset.owned || expected.state !== "rejected") return false;
  return (
    asset.state === "rejected" &&
    asset.version === expected.version &&
    asset.path === expected.path &&
    asset.sourcePath === expected.sourcePath &&
    asset.checksum === expected.checksum &&
    asset.sizeBytes.toString() === expected.sizeBytes &&
    asset.ownershipEpoch === expected.ownershipEpoch &&
    asset.supersededByAssetId === expected.supersededByAssetId &&
    identityHash(asset.properties) === identityHash(expected.properties) &&
    identityHash(retainedRollbackClocks(asset)) ===
      identityHash({
        plexPublishedAt: expected.plexPublishedAt,
        rollbackExpiresAt: expected.rollbackExpiresAt,
      }) &&
    identityHash(
      asset.coverage.map(({ mediaId, edition, current }) => ({
        mediaId,
        edition,
        current,
      })),
    ) === identityHash(expected.coverage)
  );
}

function retainedRollbackClocks(asset: MovieSourceCohort["assets"][number]) {
  return {
    plexPublishedAt: asset.plexPublishedAt?.toISOString() ?? null,
    rollbackExpiresAt: asset.rollbackExpiresAt?.toISOString() ?? null,
  };
}

/** This protocol's current asset guard rejects retained B before effects; its
 * historical ACK reads immutable library receipts. Neither path reads downloads. */
export function movieCaptionUsesRetainedRollbackV1(
  operation: Operation,
  torrent: MovieSourceCohort,
  scope: MovieEditionScope,
  completions: ReadonlyMap<string, Completion>,
) {
  const assetId = movieCaptionLibraryTargetV1(operation, torrent, scope);
  const asset = torrent.assets.find((row) => row.id === assetId);
  return (
    asset !== undefined && movieRetainedRollbackAssetV1(asset, completions)
  );
}

/** After actual physical+original-item Plex closure, this exact manual command
 * can only acknowledge the immutable library result and finish global metadata.
 * Its queued/running wrapper does not retain a dependency on download bytes. */
export function movieRollbackUsesCompletedLibraryV1(
  operation: Operation,
  scope: MovieEditionScope,
  completions: ReadonlyMap<string, Completion>,
) {
  if (operation.kind !== "rollback_movie_edition_v1") return false;
  const completed = [...completions.values()].filter(
    (parent) => parent.operation.id === operation.id,
  );
  if (completed.length > 1)
    throw new Error("Movie source manual rollback completion is ambiguous");
  const parent = completed[0];
  return (
    parent?.intent.invocation.mode === "manual_verified" &&
    parent.intent.invocation.command.operationId === operation.id &&
    operation.targetId === scope.mediaId &&
    identityHash(parent.intent.scope) === identityHash(scope) &&
    operation.userId === parent.operation.userId &&
    identityHash(operation.payload) === identityHash(parent.operation.payload)
  );
}
