import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import {
  MovieRetryRenewalEnvelopeV1Schema,
  MovieRetryRenewalV1Schema,
  type MovieRetryRenewalV1,
} from "#shared/movie-editions/retry/v1.ts";
import type { MovieOperationV4 } from "#shared/movie-editions/automation-v4.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";

export function readMovieRetryRenewalV1(raw: unknown, input: MovieOperationV4) {
  const value = z
    .object({ movieRetryRenewalV1: z.unknown().optional() })
    .nullable()
    .parse(raw)?.movieRetryRenewalV1;
  if (value === undefined) return null;
  const envelope = MovieRetryRenewalEnvelopeV1Schema.parse(value);
  if (
    identityHash(envelope.receipt) !== envelope.receiptHash ||
    identityHash(envelope.receipt.input) !== identityHash(input)
  )
    throw new Error(
      "Movie retry renewal changed its literal input or receipt hash",
    );
  return envelope.receipt;
}

/** Same original generation, immutable proof and coordinator renewal commit together. */
export async function commitMovieRetryRenewalV1(
  tx: Prisma.TransactionClient,
  receipt: MovieRetryRenewalV1,
  freshness: PlexBindingFreshness,
) {
  freshness.assertActive();
  await bindPlexTransactionDeadline(tx, freshness);
  const parsed = MovieRetryRenewalV1Schema.parse(receipt);
  const changed = await tx.acquisitionAttempt.updateMany({
    where: {
      id: parsed.capture.attemptId,
      coordinatorOperationId: parsed.capture.previousCoordinatorOperationId,
      filePlan: { equals: Prisma.DbNull },
    },
    data: { coordinatorOperationId: parsed.input.operationId },
  });
  if (changed.count !== 1)
    throw new Error(
      "Movie retry acquisition changed before coordinator renewal",
    );
  const envelope = {
    receipt: z.json().parse(parsed),
    receiptHash: identityHash(parsed),
  };
  const stored =
    await tx.$executeRaw`UPDATE "Operation" SET status='running',result=COALESCE(result,'{}'::jsonb) || jsonb_build_object('movieRetryRenewalV1',${JSON.stringify(envelope)}::jsonb)
    WHERE id=${parsed.input.operationId} AND NOT (COALESCE(result,'{}'::jsonb) ? 'movieRetryRenewalV1')`;
  if (stored !== 1) throw new Error("Movie retry renewal was already recorded");
  freshness.assertActive();
}
