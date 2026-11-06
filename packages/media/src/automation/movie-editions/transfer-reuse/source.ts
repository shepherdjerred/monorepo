import type { AcquisitionAttempt, Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  readMovieTransferReuseGrantV1,
  type MovieTransferReadOptions,
} from "#infrastructure/movie-editions/transfer-reuse/read.ts";
import { StoredTorrentObservationSchema } from "#integrations/qbittorrent.ts";
import { assertTorrentOwnership } from "#integrations/qbittorrent-ownership.ts";
import { IntegrationError } from "#integrations/http.ts";
import { z } from "zod";

function literalDirectSource(
  attempt: AcquisitionAttempt,
  snapshot: NonNullable<MovieTransferReadOptions["actualSource"]>,
) {
  const { torrent } = snapshot;
  if (
    !torrent.owned ||
    torrent.ownershipEpoch !== attempt.recoveryEpoch ||
    attempt.torrentId !== torrent.id ||
    torrent.infoHash !== snapshot.infoHash ||
    torrent.providerId !== snapshot.providerId
  )
    return false;
  const stored = z
    .object({ torrent: StoredTorrentObservationSchema })
    .safeParse(torrent.observation);
  if (!stored.success) return false;
  const observed = stored.data.torrent;
  if (
    observed.hash !== torrent.qbittorrentId ||
    (observed.infohash_v1 !== torrent.infoHash &&
      observed.infohash_v2 !== torrent.infoHash)
  )
    return false;
  try {
    assertTorrentOwnership(
      observed,
      {
        operationId: attempt.operationId,
        attemptId: attempt.id,
        savePath: `/downloads/media/${attempt.id}`,
      },
      "media",
    );
    return observed.content_path.startsWith(`/downloads/media/${attempt.id}/`);
  } catch (error) {
    if (!(error instanceof IntegrationError)) throw error;
    return false;
  }
}

/** Exactly one direct owner or one flat immutable grant; never infer ownership from attempt ordering. */
export async function resolveMovieTransferSourceV1(
  tx: Prisma.TransactionClient,
  attempt: AcquisitionAttempt,
  budget: PublicationAuthorityReadBudget,
  options: MovieTransferReadOptions = {},
) {
  if (options.actualSource !== undefined) {
    if (options.actualSource.transaction !== tx)
      throw new Error("Movie source observation cannot cross transactions");
    if (literalDirectSource(attempt, options.actualSource)) {
      if (options.lock === true) {
        await tx.$queryRaw`SELECT id FROM "AcquisitionAttempt" WHERE id=${attempt.id} FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM "Torrent" WHERE id=${options.actualSource.torrent.id} FOR SHARE`;
      }
      return { owner: attempt, grant: null, torrent: null };
    }
  }
  const reused = await readMovieTransferReuseGrantV1(
    tx,
    attempt,
    budget,
    options,
  );
  return reused === null
    ? { owner: attempt, grant: null, torrent: null }
    : { owner: reused.origin, grant: reused.grant, torrent: reused.torrent };
}
