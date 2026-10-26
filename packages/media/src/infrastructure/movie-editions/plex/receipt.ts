import { z } from "zod";
import type {
  AcquisitionAttempt,
  Operation,
  Prisma,
} from "#generated/prisma/client.ts";
import {
  MoviePlexReceiptV2Schema,
  type MoviePlexReceiptV2,
} from "#shared/movie-editions/plex-v2.ts";
import type { MovieAttemptOperationV4 } from "#shared/movie-editions/automation-v4.ts";
import {
  MovieFilePlanV2Schema,
  type MovieFilePlanV2,
} from "#shared/movie-editions/file-plan-v2.ts";
import { PlexMovieAssociationV2Schema } from "#shared/plex-binding/contract.ts";
import { loadMoviePublicationV2 } from "#infrastructure/movie-editions/publication/store.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { parsePlexRecord } from "#infrastructure/plex-binding/records.ts";

export function moviePlexAttemptParentV2(attempt: AcquisitionAttempt) {
  return {
    operationId: attempt.operationId,
    coordinatorOperationId: attempt.coordinatorOperationId,
    releaseId: attempt.releaseId,
    sponsorRequestId: attempt.sponsorRequestId,
    torrentId: attempt.torrentId,
    recoveryEpoch: attempt.recoveryEpoch,
    identityHash: identityHash(attempt.identityEvidence),
    birthHash: identityHash({
      choiceId: attempt.movieEditionChoiceId,
      choiceRevision: attempt.movieEditionChoiceRevision,
      authority: attempt.movieEditionAuthority,
    }),
    generationsHash: identityHash(attempt.generations),
    filePlanHash: identityHash(attempt.filePlan),
  };
}
export function moviePlexCommandParentV2(command: Operation) {
  return {
    kind: command.kind,
    targetId: command.targetId,
    userId: command.userId,
    payloadHash: identityHash(command.payload),
  };
}

/** Historical ACK validates literal immutable parents, never fresh configuration or a replacement file. */
export async function readMoviePlexReceiptV2(
  tx: Prisma.TransactionClient,
  input: MovieAttemptOperationV4,
  budget: PublicationAuthorityReadBudget,
): Promise<MoviePlexReceiptV2 | null> {
  const command = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  budget.consume(1);
  const raw = z
    .object({ moviePlexReceiptV2: z.unknown().optional() })
    .nullable()
    .parse(command.result)?.moviePlexReceiptV2;
  if (raw === undefined) return null;
  const envelope = z
    .strictObject({ receiptHash: z.string(), receipt: z.json() })
    .parse(raw);
  const receipt = parsePlexRecord(
    MoviePlexReceiptV2Schema,
    envelope.receipt,
    envelope.receiptHash,
  );
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
  });
  budget.consume(1);
  if (
    identityHash(receipt.input) !== identityHash(input) ||
    identityHash(receipt.command) !==
      identityHash(moviePlexCommandParentV2(command)) ||
    identityHash(receipt.attempt) !==
      identityHash(moviePlexAttemptParentV2(attempt)) ||
    !["imported", "completed"].includes(attempt.state)
  )
    throw new Error("Movie Plex receipt command or original attempt changed");
  await assertMoviePlexReceiptParentsV2(tx, receipt, budget);
  return receipt;
}

export async function assertMoviePlexReceiptParentsV2(
  tx: Prisma.TransactionClient,
  receipt: MoviePlexReceiptV2,
  budget: PublicationAuthorityReadBudget,
) {
  const publication = await loadMoviePublicationV2(
    tx,
    receipt.input.attemptId,
    budget,
  );
  if (
    publication?.outcome?.kind !== "published" ||
    publication.outcomeHash === null ||
    identityHash(receipt.publication) !==
      identityHash({
        transitionId: publication.reference.transitionId,
        intentHash: publication.reference.intentHash,
        outcomeHash: publication.outcomeHash,
      })
  )
    throw new Error("Movie Plex receipt physical publication parent changed");
  const plan = MovieFilePlanV2Schema.parse(publication.attempt.filePlan);
  const entry = plan.entries[0];
  const association = receipt.observation.associations[0];
  assertMoviePlexReceiptScope(receipt, plan);
  assertMoviePlexReceiptAssociation(receipt);
  const evidence = await tx.plexAssociationEvidence.findUniqueOrThrow({
    where: { id: receipt.binding.evidenceId },
  });
  budget.consume(1);
  const literal = parsePlexRecord(
    PlexMovieAssociationV2Schema,
    evidence.evidence,
    evidence.associationHash,
  );
  if (
    identityHash(literal) !== receipt.binding.associationHash ||
    evidence.mediaId !== plan.scope.mediaId ||
    evidence.edition !== plan.scope.edition ||
    evidence.assetId !== entry.assetId ||
    evidence.serverMachineId !== association.access.serverMachineId
  )
    throw new Error("Movie Plex receipt immutable association changed");
}

function assertMoviePlexReceiptScope(
  receipt: MoviePlexReceiptV2,
  plan: MovieFilePlanV2,
) {
  const entry = plan.entries[0];
  const target = receipt.expected.targets[0];
  const group = receipt.expected.newGroups[0];
  if (
    identityHash(plan.scope) !== identityHash(receipt.input.scope) ||
    receipt.attempt.coordinatorOperationId !== receipt.input.operationId ||
    receipt.command.targetId !== plan.scope.mediaId ||
    receipt.expected.targets.length !== 1 ||
    target?.scope.mediaId !== plan.scope.mediaId ||
    target.scope.edition !== plan.scope.edition ||
    group?.assetId !== entry.assetId ||
    group.checksum !== entry.checksum ||
    group.sizeBytes !== entry.sizeBytes ||
    receipt.expected.newGroups.length !== 1
  )
    throw new Error(
      "Movie Plex receipt lost exact scope, physical bytes or canonical metadata",
    );
}

function assertMoviePlexReceiptAssociation(receipt: MoviePlexReceiptV2) {
  const association = receipt.observation.associations[0];
  const target = receipt.expected.targets[0];
  if (
    target === undefined ||
    identityHash(association.group) !==
      identityHash(receipt.expected.newGroups[0]) ||
    association.canonicalIdentityHash !== target.canonicalIdentityHash ||
    association.numberingHash !== target.numberingHash ||
    identityHash(association.definition) !== identityHash(target.definition) ||
    identityHash(receipt.expected.access) !== identityHash([association.access])
  )
    throw new Error("Movie Plex receipt canonical association changed");
  if (
    receipt.binding.scope.mediaId !== receipt.input.scope.mediaId ||
    receipt.binding.scope.edition !== receipt.input.scope.edition ||
    receipt.binding.associationHash !== identityHash(association) ||
    Date.parse(receipt.publishedAt) <
      Date.parse(receipt.observation.verification.completedAt) ||
    Date.parse(receipt.publishedAt) > Date.parse(receipt.committedAt) ||
    Date.parse(receipt.committedAt) <
      Date.parse(receipt.observation.verification.completedAt) ||
    Date.parse(receipt.committedAt) >=
      Date.parse(receipt.observation.verification.expiresAt)
  )
    throw new Error(
      "Movie Plex receipt binding or original verification deadline changed",
    );
}
