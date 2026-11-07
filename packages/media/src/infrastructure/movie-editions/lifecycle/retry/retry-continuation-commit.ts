import { z } from "zod";
import type { AcquisitionAttempt, Prisma } from "#generated/prisma/client.ts";
import {
  MovieRetryRenewalV2Schema,
  MovieRetryRenewalEnvelopeV2Schema,
  type MovieRetryRenewalV2,
} from "#shared/movie-editions/retry/v2.ts";
import type { MovieOperationV4 } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeAttempt } from "#infrastructure/native-recovery/snapshots.ts";

export function readMovieRetryRenewalV2(raw: unknown, input: MovieOperationV4) {
  const marker = z
    .object({ movieRetryRenewalV2: z.unknown().optional() })
    .nullable()
    .parse(raw)?.movieRetryRenewalV2;
  if (marker === undefined) return null;
  const envelope = MovieRetryRenewalEnvelopeV2Schema.parse(marker);
  if (
    identityHash(envelope.receipt) !== envelope.receiptHash ||
    identityHash(envelope.receipt.input) !== identityHash(input) ||
    identityHash(envelope.receipt.beforeAttempt) !==
      envelope.receipt.capture.continuation.beforeAttemptHash ||
    identityHash(envelope.receipt.beforeAttempt.filePlan) !==
      envelope.receipt.capture.continuation.filePlanHash
  )
    throw new Error(
      "Movie continuation renewal changed its original input or literal hash",
    );
  return envelope.receipt;
}

/** The immutable SQL birth validates the actual before snapshot and same-transaction parent closure. */
export async function commitMovieRetryRenewalV2(
  tx: Prisma.TransactionClient,
  input: { receipt: MovieRetryRenewalV2; attempt: AcquisitionAttempt },
  freshness: PlexBindingFreshness,
) {
  const receipt = MovieRetryRenewalV2Schema.parse(input.receipt);
  freshness.assertActive();
  await bindPlexTransactionDeadline(tx, freshness);
  const before = receipt.beforeAttempt;
  const actual = input.attempt;
  // The integrating caller supplies the actual snapshot already queried under the original held lock and allowance.
  if (
    identityHash(nativeAttempt(actual)) !== identityHash(before) ||
    identityHash(before) !== receipt.capture.continuation.beforeAttemptHash ||
    identityHash(actual.filePlan) !== receipt.capture.continuation.filePlanHash
  )
    throw new Error(
      "Movie continuation before snapshot differs from its actual locked acquisition",
    );
  const changed = await tx.acquisitionAttempt.updateMany({
    where: {
      id: before.id,
      coordinatorOperationId: before.coordinatorOperationId,
      state: before.state,
      torrentId: before.torrentId,
      filePlan: { equals: before.filePlan },
    },
    data: { coordinatorOperationId: receipt.input.operationId },
  });
  if (changed.count !== 1)
    throw new Error(
      "Movie continuation changed before its exact coordinator renewal",
    );
  const envelope = {
    receipt: z.json().parse(receipt),
    receiptHash: identityHash(receipt),
  };
  const stored =
    await tx.$executeRaw`UPDATE "Operation" SET status='running',result=COALESCE(result,'{}'::jsonb)||jsonb_build_object('movieRetryRenewalV2',${JSON.stringify(envelope)}::jsonb)
    WHERE id=${receipt.input.operationId} AND NOT(COALESCE(result,'{}'::jsonb)?'movieRetryRenewalV2')`;
  if (stored !== 1)
    throw new Error("Movie continuation renewal was already recorded");
  freshness.assertActive();
}
