import { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";

export const SERIES_PACK_PUBLICATION_PENDING =
  "series_pack_publication_pending";

export class SeriesPackPublicationProtection extends MediaError {
  constructor() {
    super(
      SERIES_PACK_PUBLICATION_PENDING,
      "The complete TV pack publication must settle before this action",
      409,
    );
  }
}

type Scope = { mediaIds: readonly string[]; assetIds?: readonly string[] };

/** Current operational fence only; this projection never grants publication authority. */
export function pendingSeriesPackPublicationsV1(
  tx: Prisma.TransactionClient,
  input: Scope,
) {
  return tx.mediaPublicationTransition.findMany({
    where: {
      intent: { path: ["schemaVersion"], equals: 3 },
      outcome: { equals: Prisma.DbNull },
      // Only SQL055's actual immutable verified-serving/release pair settles
      // the pending fence; physical compensation or an owner approval does not.
      compensations: {
        none: {
          descriptor: { path: ["schemaVersion"], equals: 2 },
          state: "compensated",
          completion: { not: Prisma.DbNull },
          verifiedPublication: { not: Prisma.DbNull },
          fenceRelease: { not: Prisma.DbNull },
        },
      },
      OR: [
        { attempt: { mediaIds: { hasSome: [...input.mediaIds] } } },
        ...(input.assetIds ?? []).flatMap((assetId) => [
          {
            intent: {
              path: ["entries"],
              array_contains: [{ entry: { assetId } }],
            },
          },
          {
            intent: {
              path: ["entries"],
              array_contains: [{ entry: { previousAssetId: assetId } }],
            },
          },
        ]),
      ],
    },
    select: { attemptId: true, attempt: { select: { mediaIds: true } } },
    take: 101,
  });
}

/** Canonical locks precede mutation checks; only the exact complete owner may continue its publication. */
export async function assertNoPendingSeriesPackPublicationV1(
  tx: Prisma.TransactionClient,
  input: Scope & { seriesPackPublicationAttemptId?: string | undefined },
) {
  const pending = await pendingSeriesPackPublicationsV1(tx, input);
  if (
    pending.length > 100 ||
    pending.some(
      (row) =>
        row.attemptId !== input.seriesPackPublicationAttemptId ||
        row.attempt.mediaIds.length !== input.mediaIds.length ||
        new Set(input.mediaIds).size !== input.mediaIds.length ||
        row.attempt.mediaIds.some((id) => !input.mediaIds.includes(id)),
    )
  )
    throw new SeriesPackPublicationProtection();
}

export async function hasPendingSeriesPackPublicationV1(
  tx: Prisma.TransactionClient,
  input: Scope,
) {
  const pending = await pendingSeriesPackPublicationsV1(tx, input);
  return pending.length > 0;
}
