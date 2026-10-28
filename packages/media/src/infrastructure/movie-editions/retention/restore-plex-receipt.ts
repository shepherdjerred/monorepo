import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieOperationV4 } from "#shared/movie-editions/automation-v4.ts";
import {
  MovieRestorePlexReceiptEnvelopeV1Schema,
  MovieRestorePlexReceiptV1Schema,
  type MovieRestorePlexReceiptV1,
} from "#shared/movie-editions/restore-plex-v1.ts";
import { PlexMovieAssociationV2Schema } from "#shared/plex-binding/contract.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { parsePlexRecord } from "#infrastructure/plex-binding/records.ts";
import { readMovieRestorePublicationParentV1 } from "#infrastructure/movie-editions/publication/restore-records.ts";
import { readMovieRestoreCommand } from "./restore-source.ts";
import { MovieQuarantinePlexReceiptV2Schema } from "#shared/movie-editions/quarantine-v2.ts";
import { readMovieRestoreOriginalItem } from "./restore-plex-identity.ts";
import { assertMovieRestorePlexReceiptV1 } from "./restore-plex-observation.ts";

/** Original ACK only: configuration, current mapping and current pointers cannot rewrite this completed history. */
export async function readMovieRestorePlexReceiptV1(
  tx: Prisma.TransactionClient,
  input: MovieOperationV4,
  budget: PublicationAuthorityReadBudget,
): Promise<MovieRestorePlexReceiptV1 | null> {
  const { operation } = await readMovieRestoreCommand(tx, input, budget);
  const raw = z
    .object({ movieRestorePlexReceiptV1: z.unknown().optional() })
    .nullable()
    .parse(operation.result)?.movieRestorePlexReceiptV1;
  if (raw === undefined) return null;
  const envelope = MovieRestorePlexReceiptEnvelopeV1Schema.parse(raw);
  const receipt = parsePlexRecord(
    MovieRestorePlexReceiptV1Schema,
    envelope.receipt,
    envelope.receiptHash,
  );
  if (
    identityHash(receipt.input) !== identityHash(input) ||
    receipt.command.kind !== operation.kind ||
    receipt.command.targetId !== operation.targetId ||
    receipt.command.userId !== operation.userId ||
    receipt.command.payloadHash !== identityHash(operation.payload)
  )
    throw new Error("Movie restore Plex immutable command changed");
  const physical = await readMovieRestorePublicationParentV1(
    tx,
    operation,
    budget,
  );
  const association = receipt.observation.associations[0];
  if (
    identityHash(physical.reference) !== identityHash(receipt.publication) ||
    physical.asset.id !== association.group.assetId ||
    physical.asset.version !== association.group.assetVersion ||
    physical.asset.checksum !== association.group.checksum ||
    physical.asset.path !== association.group.canonicalPath ||
    physical.asset.sizeBytes !== association.group.sizeBytes ||
    physical.asset.ownershipEpoch !== receipt.expected.recoveryEpoch ||
    physical.asset.plexPublishedAt !== receipt.assetPlexPublishedAt
  )
    throw new Error("Movie restore Plex physical publication parent changed");
  const quarantine = await tx.operation.findUniqueOrThrow({
    where: { id: physical.receipt.quarantine.operationId },
  });
  budget.consume(1);
  const original = parsePlexRecord(
    MovieQuarantinePlexReceiptV2Schema,
    z
      .object({ movieQuarantinePlexReceiptV2: z.json() })
      .parse(quarantine.result).movieQuarantinePlexReceiptV2,
    physical.receipt.quarantine.receiptHash,
  );
  const identity = await readMovieRestoreOriginalItem(tx, original, budget);
  if (
    identityHash(identity.item) !==
      identityHash(receipt.expected.originalItem) ||
    identityHash(identity.access) !== identityHash(association.access)
  )
    throw new Error(
      "Movie restore Plex receipt changed its original item or Part",
    );
  await assertMovieRestorePlexAssociation(tx, receipt, budget);
  assertMovieRestorePlexReceiptV1(receipt);
  return receipt;
}

async function assertMovieRestorePlexAssociation(
  tx: Prisma.TransactionClient,
  receipt: MovieRestorePlexReceiptV1,
  budget: PublicationAuthorityReadBudget,
) {
  const association = receipt.observation.associations[0];
  const row = await tx.plexAssociationEvidence.findUniqueOrThrow({
    where: { id: receipt.binding.evidenceId },
  });
  budget.consume(1);
  const literal = parsePlexRecord(
    PlexMovieAssociationV2Schema,
    row.evidence,
    row.associationHash,
  );
  if (
    row.associationHash !== receipt.binding.associationHash ||
    identityHash(literal) !== identityHash(association) ||
    row.mediaId !== receipt.input.mediaId ||
    row.edition !== receipt.input.scope.edition ||
    row.assetId !== receipt.publication.assetId ||
    row.serverMachineId !== association.access.serverMachineId
  )
    throw new Error("Movie restore Plex immutable association changed");
}
