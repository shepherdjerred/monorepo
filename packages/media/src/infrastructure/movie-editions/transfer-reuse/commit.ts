import { Prisma } from "#generated/prisma/client.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import {
  MovieTransferReuseGrantV1Schema,
  type MovieTransferReuseGrantV1,
} from "#shared/movie-editions/transfer-reuse/v1.ts";

/** Caller holds current command, both attempts and source lock. No external effect in this transaction. */
export async function commitMovieTransferReuseGrantV1(
  tx: Prisma.TransactionClient,
  raw: MovieTransferReuseGrantV1,
  freshness: PlexBindingFreshness,
) {
  const grant = MovieTransferReuseGrantV1Schema.parse(raw);
  await bindPlexTransactionDeadline(tx, freshness);
  const changed = await tx.acquisitionAttempt.updateMany({
    where: {
      id: grant.consumer.attemptId,
      operationId: grant.consumer.birthOperationId,
      coordinatorOperationId: grant.input.operationId,
      torrentId: null,
      state: "reserved",
      filePlan: { equals: Prisma.DbNull },
    },
    data: { torrentId: grant.transfer.id, state: "downloading" },
  });
  if (changed.count !== 1)
    throw new Error("Movie transfer consumer changed before grant");
  const envelope = { grant, grantHash: identityHash(grant) };
  const stored =
    await tx.$executeRaw`UPDATE "Operation" SET result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('movieTransferReuseGrantV1',${JSON.stringify(envelope)}::jsonb)
    WHERE id=${grant.consumer.birthOperationId} AND NOT(COALESCE(result,'{}'::jsonb)?'movieTransferReuseGrantV1')`;
  if (stored !== 1) throw new Error("Movie transfer grant already exists");
  freshness.assertActive();
}
