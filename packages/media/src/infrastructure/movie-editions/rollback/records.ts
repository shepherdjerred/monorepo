import { z } from "zod";
import type {
  Prisma,
  PlexAssociationEvidence,
  Operation,
} from "#generated/prisma/client.ts";
import {
  MovieRollbackIntentEnvelopeV1Schema,
  MovieRollbackPhysicalEnvelopeV1Schema,
  type MovieRollbackIntentV1,
} from "#shared/movie-editions/rollback/physical.ts";
import { MovieRollbackPlexEnvelopeV1Schema } from "#shared/movie-editions/rollback/plex.ts";
import {
  MovieRollbackInvocationV1Schema,
  type MovieRollbackInvocationV1,
} from "#shared/movie-editions/rollback/operation.ts";
import { MovieRollbackReferenceV1Schema } from "#shared/movie-editions/rollback/reference.ts";
import {
  PlexMovieAssociationV2Schema,
  type PlexMovieAssociationV2,
} from "#shared/plex-binding/contract.ts";
import type { MoviePublicationAssetV2 } from "#shared/movie-editions/publication-v2.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { loadMoviePublicationV2 } from "#infrastructure/movie-editions/publication/records.ts";
import {
  moviePlexAttemptParentV2,
  moviePlexCommandParentV2,
} from "#infrastructure/movie-editions/plex/receipt.ts";
import { parsePlexRecord } from "#infrastructure/plex-binding/records.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  assertMovieRollbackPhysicalV1,
  assertMovieRollbackPlexV1,
  assertMovieRollbackAdmissionClockV1,
} from "./validation.ts";
import { parseMoviePlexRejectionV1 } from "./rejection-records.ts";
import { assertMovieRollbackCanonical } from "./canonical.ts";
import { assertMovieRollbackAttemptBytesV1 } from "./parent-bytes.ts";
import { parseRequestedMovieRollbackCommandV1 } from "./manual/manual-command-records.ts";
import { readRequestedMovieRollbackPlaybackV1 } from "./playback-records.ts";

export function movieRollbackOperationId(
  invocation: MovieRollbackInvocationV1,
) {
  return invocation.mode === "automatic_failed_plex"
    ? invocation.source.operationId
    : invocation.command.operationId;
}

export function assertRollbackOriginalEvidence(
  intent: MovieRollbackIntentV1,
  evidence: PlexAssociationEvidence,
  association: PlexMovieAssociationV2,
  original: MoviePublicationAssetV2,
) {
  const part = association.item.media[0].parts[0];
  if (
    evidence.associationHash !== intent.originalItem.binding.associationHash ||
    evidence.assetId !== original.id ||
    evidence.mediaId !== intent.scope.mediaId ||
    evidence.edition !== intent.scope.edition ||
    evidence.serverMachineId !== association.access.serverMachineId ||
    association.group.assetId !== original.id ||
    association.group.assetVersion !== original.version ||
    association.group.checksum !== original.checksum ||
    association.group.sizeBytes !== original.sizeBytes ||
    association.group.canonicalPath !== original.path ||
    association.group.ownershipEpoch !== original.ownershipEpoch ||
    identityHash(association.scope) !==
      identityHash(intent.originalItem.binding.scope) ||
    identityHash(association.access) !== identityHash(intent.originalAccess) ||
    association.item.ratingKey !== intent.originalItem.ratingKey ||
    part.id !== intent.originalItem.part.id ||
    part.file !== intent.originalItem.part.file
  )
    throw new Error(
      "Movie rollback original serving item lost its exact immutable predecessor",
    );
}

/** Load the actual command and immutable source, independently of today's consent. */
export async function readMovieRollbackIntentV1(
  tx: Prisma.TransactionClient,
  raw: MovieRollbackInvocationV1,
  budget: PublicationAuthorityReadBudget,
) {
  const invocation = MovieRollbackInvocationV1Schema.parse(raw);
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: movieRollbackOperationId(invocation) },
  });
  budget.consume(1);
  return rollbackIntentFromOperationV1(tx, { invocation, operation, budget });
}

/** Only the actual Operation just queried by this transaction may supply its
 * immutable marker. This helper grants no live authority or cross-TX cache. */
export async function rollbackIntentFromOperationV1(
  tx: Prisma.TransactionClient,
  input: {
    invocation: MovieRollbackInvocationV1;
    operation: Operation;
    budget: PublicationAuthorityReadBudget;
  },
) {
  const { invocation, operation, budget } = input;
  const marker = z
    .object({ movieRollbackIntentV1: z.unknown().optional() })
    .nullable()
    .parse(operation.result)?.movieRollbackIntentV1;
  if (marker === undefined) return null;
  const envelope = MovieRollbackIntentEnvelopeV1Schema.parse(marker);
  assertMovieRollbackCanonical(
    envelope.raw,
    envelope.intent,
    envelope.intentHash,
  );
  const intent = parsePlexRecord(
    MovieRollbackIntentEnvelopeV1Schema.shape.intent,
    envelope.intent,
    envelope.intentHash,
  );
  assertMovieRollbackAdmissionClockV1(intent);
  assertMovieRollbackCanonical(
    intent.command.payloadRaw,
    operation.payload,
    intent.command.payloadHash,
  );
  if (
    identityHash(intent.invocation) !== identityHash(invocation) ||
    intent.operationId !== operation.id ||
    intent.command.kind !== operation.kind ||
    intent.command.targetId !== operation.targetId ||
    intent.command.userId !== operation.userId ||
    intent.command.payloadHash !== identityHash(operation.payload)
  )
    throw new Error("Movie rollback admission changed its actual command");
  const parents = await assertMovieRollbackIntentParentsV1(
    tx,
    intent,
    budget,
    operation,
  );
  return { operation, intent, intentHash: envelope.intentHash, parents };
}

async function assertMovieRollbackIntentParentsV1(
  tx: Prisma.TransactionClient,
  intent: MovieRollbackIntentV1,
  budget: PublicationAuthorityReadBudget,
  operation: Operation,
) {
  const source = await loadMoviePublicationV2(
    tx,
    intent.invocation.source.attemptId,
    budget,
  );
  const sameCommand = operation.id === intent.invocation.source.operationId;
  const command = sameCommand
    ? operation
    : await tx.operation.findUniqueOrThrow({
        where: { id: intent.invocation.source.operationId },
      });
  if (!sameCommand) budget.consume(1);
  if (source === null)
    throw new Error(
      "Movie rollback lost its actual committed source publication",
    );
  assertMovieRollbackAttemptBytesV1(
    source.attempt,
    intent.authority,
    intent.authority,
  );
  assertMovieRollbackCanonical(
    intent.source.attemptRaw,
    moviePlexAttemptParentV2(source.attempt),
    intent.source.attemptHash,
  );
  assertMovieRollbackCanonical(
    intent.source.commandRaw,
    moviePlexCommandParentV2(command),
    intent.source.commandHash,
  );
  assertMovieRollbackCanonical(
    intent.source.commandPayloadRaw,
    command.payload,
    moviePlexCommandParentV2(command).payloadHash,
  );
  if (
    source.outcome?.kind !== "published" ||
    source.outcomeHash !== intent.source.outcomeHash ||
    identityHash(source.reference) !== identityHash(intent.source.reference) ||
    identityHash(source.reference.intent.scope) !==
      identityHash(intent.scope) ||
    identityHash(intent.invocation.source.scope) !==
      identityHash(intent.scope) ||
    identityHash(source.outcome) !== identityHash(intent.source.outcome) ||
    source.attempt.coordinatorOperationId !== command.id ||
    source.attempt.state !== intent.source.state ||
    identityHash(moviePlexAttemptParentV2(source.attempt)) !==
      intent.source.attemptHash ||
    identityHash(moviePlexCommandParentV2(command)) !==
      intent.source.commandHash
  )
    throw new Error(
      "Movie rollback lost its literal committed source publication",
    );
  const evidence = await tx.plexAssociationEvidence.findUniqueOrThrow({
    where: { id: intent.originalItem.binding.evidenceId },
  });
  budget.consume(1);
  const association = parsePlexRecord(
    PlexMovieAssociationV2Schema,
    evidence.evidence,
    intent.originalItem.binding.associationHash,
  );
  const original = source.reference.intent.entries[0].predecessor;
  if (original === null)
    throw new Error(
      "Movie rollback original serving item lost its exact immutable predecessor",
    );
  assertRollbackOriginalEvidence(intent, evidence, association, original);
  if (intent.rejection !== null) {
    const event = await tx.applicationEvent.findUniqueOrThrow({
      where: { id: intent.rejection.eventId },
    });
    budget.consume(1);
    const rejection = parseMoviePlexRejectionV1({
      event,
      source,
      command,
      expectedInput: intent.invocation.source,
    });
    if (rejection.receiptHash !== intent.rejection.receiptHash)
      throw new Error(
        "Movie rollback lost its immutable actual rejected observation",
      );
  }
  if (intent.invocation.mode === "manual_verified")
    await assertRequestedRollbackObservations(
      tx,
      { intent, operation },
      budget,
    );
  return { source, command, association };
}

async function assertRequestedRollbackObservations(
  tx: Prisma.TransactionClient,
  input: { intent: MovieRollbackIntentV1; operation: Operation },
  budget: PublicationAuthorityReadBudget,
) {
  const { intent, operation } = input;
  if (
    intent.invocation.mode !== "manual_verified" ||
    intent.playback === undefined
  )
    throw new Error("Manual rollback lost its actual command/playback parent");
  const command = parseRequestedMovieRollbackCommandV1(
    operation,
    intent.invocation.command,
  );
  if (
    intent.successorGrantRaw === undefined ||
    intent.captionManifestRaw === undefined ||
    intent.captionManifest === undefined
  )
    throw new Error(
      "Manual movie rollback lost its literal native/grant bytes",
    );
  assertMovieRollbackCanonical(
    intent.successorGrantRaw,
    intent.successorGrant,
    command.expected.successor.publicationHash,
  );
  assertMovieRollbackCanonical(
    intent.captionManifestRaw,
    intent.captionManifest,
    identityHash(intent.captionManifest),
  );
  const admission = await readRequestedMovieRollbackPlaybackV1(
    tx,
    command,
    budget,
    intent.playback,
  );
  if (
    admission.guard.phase !== "admission" ||
    admission.guard.admission !== null ||
    Date.parse(admission.guard.completedAt) > Date.parse(intent.admittedAt) ||
    Date.parse(intent.admittedAt) >= Date.parse(admission.guard.expiresAt) ||
    identityHash(intent.cleanup) !== identityHash(command.expected.cleanup) ||
    intent.successorGrant === null ||
    identityHash(intent.successorGrant) !==
      command.expected.successor.publicationHash
  )
    throw new Error(
      "Manual movie rollback lost its actual bounded admission observation or reviewed successor",
    );
  const raw = z
    .object({
      movieRollbackPhysicalV1: MovieRollbackPhysicalEnvelopeV1Schema.optional(),
    })
    .nullable()
    .parse(operation.result)?.movieRollbackPhysicalV1;
  if (raw === undefined) return;
  await assertRequestedPhysicalPlayback(
    tx,
    { intent, command, receipt: raw.receipt },
    budget,
  );
}

async function assertRequestedPhysicalPlayback(
  tx: Prisma.TransactionClient,
  input: {
    intent: MovieRollbackIntentV1;
    command: ReturnType<typeof parseRequestedMovieRollbackCommandV1>;
    receipt: z.infer<typeof MovieRollbackPhysicalEnvelopeV1Schema>["receipt"];
  },
  budget: PublicationAuthorityReadBudget,
) {
  const { intent, command, receipt } = input;
  if (receipt.playback === undefined)
    throw new Error(
      "Manual physical completion lost its actual playback parent",
    );
  const physical = await readRequestedMovieRollbackPlaybackV1(
    tx,
    command,
    budget,
    receipt.playback,
  );
  if (
    physical.guard.phase !== "physical" ||
    physical.guard.admission?.intentId !== intent.id ||
    physical.guard.admission.intentHash !== identityHash(intent) ||
    Date.parse(receipt.observedAt) < Date.parse(physical.guard.completedAt) ||
    Date.parse(receipt.committedAt) >= Date.parse(physical.guard.expiresAt)
  )
    throw new Error(
      "Manual physical completion lost its fresh actual admitted-phase observation",
    );
}

/** Historical physical ACK never reinterprets today's LibraryAsset as its old parent. */
export async function readMovieRollbackPhysicalV1(
  tx: Prisma.TransactionClient,
  invocation: MovieRollbackInvocationV1,
  budget: PublicationAuthorityReadBudget,
) {
  const parent = await readMovieRollbackIntentV1(tx, invocation, budget);
  return parent === null ? null : movieRollbackPhysicalFromIntentV1(parent);
}

/** The caller already resolved these immediate immutable parents in this same
 * transaction. This parser performs no IO and grants no current authority. */
export function movieRollbackPhysicalFromIntentV1(
  parent: NonNullable<Awaited<ReturnType<typeof readMovieRollbackIntentV1>>>,
) {
  const raw = z
    .object({ movieRollbackPhysicalV1: z.unknown().optional() })
    .nullable()
    .parse(parent.operation.result)?.movieRollbackPhysicalV1;
  if (raw === undefined) return null;
  const envelope = MovieRollbackPhysicalEnvelopeV1Schema.parse(raw);
  assertMovieRollbackCanonical(
    envelope.raw,
    envelope.receipt,
    envelope.receiptHash,
  );
  const receipt = parsePlexRecord(
    MovieRollbackPhysicalEnvelopeV1Schema.shape.receipt,
    envelope.receipt,
    envelope.receiptHash,
  );
  assertMovieRollbackPhysicalV1(parent.intent, receipt);
  const reference = MovieRollbackReferenceV1Schema.parse({
    kind: "movie_rollback_publication_v1",
    scope: receipt.scope,
    operationId: receipt.operationId,
    intentId: receipt.intentId,
    intentHash: receipt.intentHash,
    physicalHash: envelope.receiptHash,
    assetId: receipt.predecessor.id,
    assetVersion: receipt.predecessor.version,
    bindingHash: receipt.bindingHash,
    physicalEvidenceHash: receipt.physicalEvidenceHash,
  });
  return {
    ...parent,
    receipt,
    physicalHash: envelope.receiptHash,
    reference,
    asset: receipt.predecessor,
  };
}

export async function readMovieRollbackPlexV1(
  tx: Prisma.TransactionClient,
  invocation: MovieRollbackInvocationV1,
  budget: PublicationAuthorityReadBudget,
) {
  const parsed = MovieRollbackInvocationV1Schema.parse(invocation);
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: movieRollbackOperationId(parsed) },
  });
  budget.consume(1);
  const raw = z
    .object({ movieRollbackPlexV1: z.unknown().optional() })
    .nullable()
    .parse(operation.result)?.movieRollbackPlexV1;
  if (raw === undefined) return null;
  const admitted = await rollbackIntentFromOperationV1(tx, {
    invocation: parsed,
    operation,
    budget,
  });
  const parent =
    admitted === null ? null : movieRollbackPhysicalFromIntentV1(admitted);
  if (parent === null)
    throw new Error(
      "Movie rollback serving receipt has no actual immutable physical parent",
    );
  const envelope = MovieRollbackPlexEnvelopeV1Schema.parse(raw);
  assertMovieRollbackCanonical(
    envelope.raw,
    envelope.receipt,
    envelope.receiptHash,
  );
  const receipt = parsePlexRecord(
    MovieRollbackPlexEnvelopeV1Schema.shape.receipt,
    envelope.receipt,
    envelope.receiptHash,
  );
  if (
    receipt.operationId !== parent.operation.id ||
    receipt.intentId !== parent.intent.id ||
    receipt.intentHash !== parent.intentHash ||
    receipt.physicalHash !== parent.physicalHash ||
    identityHash(receipt.invocation) !== identityHash(invocation) ||
    identityHash(receipt.publication) !== identityHash(parent.reference) ||
    identityHash(receipt.expected.parents[0].reference) !==
      identityHash(parent.reference) ||
    identityHash(receipt.expected.originalItem) !==
      identityHash(parent.intent.originalItem) ||
    receipt.binding.revision !== parent.receipt.retiredPointer.revision + 1 ||
    receipt.assetPlexPublishedAt !== parent.asset.plexPublishedAt
  )
    throw new Error(
      "Movie rollback serving completion lost its real physical parent or original publication clock",
    );
  assertMovieRollbackPlexV1(receipt, {
    intent: parent.intent,
    physical: parent.receipt,
  });
  const association = receipt.observation.associations[0];
  const evidence = await tx.plexAssociationEvidence.findUniqueOrThrow({
    where: { id: receipt.binding.evidenceId },
  });
  budget.consume(1);
  const actual = parsePlexRecord(
    PlexMovieAssociationV2Schema,
    evidence.evidence,
    evidence.associationHash,
  );
  if (
    identityHash(actual) !== identityHash(association) ||
    evidence.associationHash !== receipt.binding.associationHash ||
    evidence.assetId !== parent.asset.id ||
    evidence.mediaId !== parent.intent.scope.mediaId ||
    evidence.edition !== parent.intent.scope.edition
  )
    throw new Error(
      "Movie rollback serving association changed its immutable evidence",
    );
  return { ...parent, plex: receipt };
}
