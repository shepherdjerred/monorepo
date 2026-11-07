import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { TorrentObservation } from "#integrations/qbittorrent.ts";
import { readMovieTransferReuseMarkerV1 } from "./read.ts";

/** Caller holds the source Torrent lock. Reserve both these actual parent reads
 * and SQL049's complete grant-parent observation validation before the write. */
export async function reserveMovieTransferObservationWriteV1(
  tx: Prisma.TransactionClient,
  input: { torrentId: string; observation: TorrentObservation },
  budget: PublicationAuthorityReadBudget,
) {
  const parents = await tx.operation.findMany({
    where: {
      result: {
        path: ["movieTransferReuseGrantV1", "grant", "transfer", "id"],
        equals: input.torrentId,
      },
    },
    orderBy: { id: "asc" },
    select: { id: true, result: true },
    take: budget.take,
  });
  budget.consume(parents.length);
  for (const parent of parents) {
    const grant = readMovieTransferReuseMarkerV1(parent.result);
    if (
      grant?.consumer.birthOperationId !== parent.id ||
      grant.transfer.id !== input.torrentId ||
      grant.transfer.qbittorrentId !== input.observation.hash ||
      grant.transfer.savePath !== input.observation.save_path ||
      grant.transfer.contentPath !== input.observation.content_path ||
      grant.transfer.tags !== input.observation.tags ||
      grant.transfer.category !== input.observation.category
    )
      throw new Error(
        "Movie transfer observation has unknown or conflicting immutable grant parents",
      );
  }
  budget.consume(parents.length);
}
