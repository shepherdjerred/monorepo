import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieOperationV4 } from "#shared/movie-editions/automation-v4.ts";
import {
  MovieRestoreReceiptEnvelopeV1Schema,
  MovieRestoreReceiptV1Schema,
  type MovieRestoreReceiptV1,
} from "#shared/movie-editions/restore-v1.ts";
import { MovieQuarantinePlexReceiptV2Schema } from "#shared/movie-editions/quarantine-v2.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { parsePlexRecord } from "#infrastructure/plex-binding/records.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { readMovieRestoreCommand } from "./restore-source.ts";
import { assertMovieRestoreReceiptV1 } from "./restore-validation.ts";

/** Historical ACK validates original immutable parents, without granting a new physical effect. */
export async function readMovieRestoreReceiptV1(
  tx: Prisma.TransactionClient,
  input: MovieOperationV4,
  budget: PublicationAuthorityReadBudget,
): Promise<MovieRestoreReceiptV1 | null> {
  const { operation, command } = await readMovieRestoreCommand(
    tx,
    input,
    budget,
  );
  const raw = z
    .object({ movieRestoreReceiptV1: z.unknown().optional() })
    .nullable()
    .parse(operation.result)?.movieRestoreReceiptV1;
  if (raw === undefined) return null;
  const envelope = MovieRestoreReceiptEnvelopeV1Schema.parse(raw);
  const receipt = parsePlexRecord(
    MovieRestoreReceiptV1Schema,
    envelope.receipt,
    envelope.receiptHash,
  );
  if (
    identityHash(receipt.input) !== identityHash(input) ||
    receipt.command.kind !== operation.kind ||
    receipt.command.targetId !== operation.targetId ||
    receipt.command.userId !== operation.userId ||
    receipt.command.payloadHash !== identityHash(operation.payload) ||
    receipt.after.ownershipEpoch !== command.recoveryEpoch
  )
    throw new Error("Movie restore immutable command changed");
  const parent = await tx.operation.findUniqueOrThrow({
    where: { id: receipt.quarantine.operationId },
  });
  budget.consume(1);
  const original = z
    .object({ movieQuarantinePlexReceiptV2: z.json() })
    .parse(parent.result).movieQuarantinePlexReceiptV2;
  const quarantine = parsePlexRecord(
    MovieQuarantinePlexReceiptV2Schema,
    original,
    receipt.quarantine.receiptHash,
  );
  if (
    parent.kind !== "retain_movie_edition_v4" ||
    parent.id !== quarantine.operationId
  )
    throw new Error("Movie restore quarantine command changed");
  assertMovieRestoreReceiptV1(receipt, quarantine);
  return receipt;
}

/** The actual restored rows, decision and receipt commit together under the original deadline. */
export async function recordMovieRestoreReceiptV1(
  tx: Prisma.TransactionClient,
  receipt: MovieRestoreReceiptV1,
  freshness: PlexBindingFreshness,
  budget: PublicationAuthorityReadBudget,
) {
  freshness.assertActive();
  await bindPlexTransactionDeadline(tx, freshness);
  const parsed = MovieRestoreReceiptV1Schema.parse(receipt);
  const envelope = {
    receipt: z.json().parse(parsed),
    receiptHash: identityHash(parsed),
  };
  const changed =
    await tx.$executeRaw`UPDATE "Operation" SET result=COALESCE(result,'{}'::jsonb) || jsonb_build_object('movieRestoreReceiptV1',${JSON.stringify(envelope)}::jsonb)
    WHERE id=${parsed.input.operationId} AND NOT (COALESCE(result,'{}'::jsonb) ? 'movieRestoreReceiptV1')`;
  if (changed !== 1)
    throw new Error("Movie restore receipt was already recorded");
  const stored = await readMovieRestoreReceiptV1(tx, parsed.input, budget);
  if (identityHash(stored) !== identityHash(parsed))
    throw new Error("Movie restore committed receipt changed");
  freshness.assertActive();
}
