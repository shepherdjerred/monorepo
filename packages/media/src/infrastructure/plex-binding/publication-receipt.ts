import path from "node:path";
import { z } from "zod";
import type {
  AcquisitionAttempt,
  Operation,
  Prisma,
} from "#generated/prisma/client.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { FilePlanEntrySchema, GenerationsSchema } from "#shared/file-plan.ts";
import { CAPACITY_ROOTS } from "#shared/capacity/contract.ts";
import type { PlexBindingExpected } from "#shared/plex-binding/expected.ts";
import type { PlexBindingSnapshot } from "#shared/plex-binding/contract.ts";
import type { VerifiedServingPlex } from "#shared/plex-binding/observations.ts";
import {
  AcquisitionPlexPublicationEnvelopeSchema,
  AcquisitionPlexPublicationInputSchema,
  type AcquisitionPlexPublicationInput,
} from "#shared/plex-binding/publication.ts";
import {
  DefaultAcquisitionPlexReceiptSchema,
  acquisitionPlexReceiptMarker,
  type DefaultAcquisitionPlexReceipt,
} from "#shared/acquisition/library-publication.ts";
import { managedSeriesIdentity } from "#shared/acquisition/library-management.ts";
import { parsePlexRecord } from "./records.ts";
import { bindPlexTransactionDeadline } from "./freshness.ts";
import { assertAcquisitionPlexEvidence } from "./publication-evidence.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

function attemptParent(attempt: AcquisitionAttempt) {
  return {
    operationId: attempt.operationId,
    coordinatorOperationId:
      attempt.coordinatorOperationId ?? attempt.operationId,
    releaseId: attempt.releaseId,
    sponsorRequestId: attempt.sponsorRequestId,
    torrentId: attempt.torrentId,
    edition: attempt.edition,
    recoveryEpoch: attempt.recoveryEpoch,
    mediaIds: attempt.mediaIds,
    generationsHash: identityHash(attempt.generations),
    filePlanHash: identityHash(attempt.filePlan),
    identityHash:
      attempt.identityEvidence === null
        ? null
        : identityHash(attempt.identityEvidence),
    movieBirthHash: identityHash({
      choiceId: attempt.movieEditionChoiceId,
      choiceRevision: attempt.movieEditionChoiceRevision,
      authority: attempt.movieEditionAuthority,
    }),
  };
}

function commandParent(operation: Operation) {
  return {
    kind: operation.kind,
    targetId: operation.targetId,
    userId: operation.userId,
    payloadHash: identityHash(operation.payload),
  };
}

function assertReceiptCommand(
  receipt: DefaultAcquisitionPlexReceipt,
  operation: Operation,
  attempt: AcquisitionAttempt,
) {
  const { input, expected, completion } = receipt;
  if (
    operation.id !== input.operationId ||
    attempt.id !== input.attemptId ||
    identityHash(commandParent(operation)) !== identityHash(receipt.command) ||
    identityHash(attemptParent(attempt)) !== identityHash(receipt.attempt) ||
    receipt.attempt.coordinatorOperationId !== operation.id ||
    !receipt.attempt.mediaIds.includes(receipt.command.targetId) ||
    !["imported", "completed"].includes(attempt.state) ||
    completion.operationId !== input.operationId ||
    completion.inputHash !== identityHash(input) ||
    completion.expectedHash !== identityHash(expected) ||
    completion.recoveryEpoch !== attempt.recoveryEpoch ||
    expected.recoveryEpoch !== attempt.recoveryEpoch
  )
    throw new Error("Acquisition Plex receipt command or attempt changed");
}

function assertReceiptParents(
  receipt: DefaultAcquisitionPlexReceipt,
  operation: Operation,
  attempt: AcquisitionAttempt,
) {
  assertReceiptCommand(receipt, operation, attempt);
  const { expected } = receipt;
  const parents = expected.parents.filter(
    (parent) => parent.kind === "acquisition",
  );
  const parent = parents[0];
  if (
    parent === undefined ||
    parents.length !== 1 ||
    parent.operationId !== attempt.operationId ||
    parent.attemptId !== attempt.id ||
    parent.planHash !== receipt.attempt.filePlanHash ||
    parent.identityHash !== receipt.attempt.identityHash ||
    parent.recoveryEpoch !== attempt.recoveryEpoch ||
    identityHash(parent.generations) !==
      identityHash(GenerationsSchema.parse(attempt.generations))
  )
    throw new Error("Acquisition Plex receipt lost its exact original parent");
  const plan = z
    .array(FilePlanEntrySchema)
    .min(1)
    .max(100)
    .parse(attempt.filePlan);
  if (
    new Set(plan.map((entry) => entry.assetId)).size !== plan.length ||
    identityHash(plan.flatMap((entry) => entry.mediaIds).sort()) !==
      identityHash([...attempt.mediaIds].sort())
  )
    throw new Error("Acquisition Plex receipt FilePlan coverage changed");
  for (const entry of plan) {
    assertReceiptPlanGroup(expected, entry, attempt.recoveryEpoch);
  }
}

function assertReceiptPlanGroup(
  expected: PlexBindingExpected,
  entry: z.infer<typeof FilePlanEntrySchema>,
  recoveryEpoch: number,
) {
  const group = expected.newGroups.find(
    (value) => value.assetId === entry.assetId,
  );
  if (
    group?.edition !== "default" ||
    group.checksum !== entry.checksum ||
    group.sizeBytes !== entry.sizeBytes ||
    group.ownershipEpoch !== recoveryEpoch ||
    group.canonicalPath !==
      path.posix.join(CAPACITY_ROOTS[entry.libraryKind], entry.libraryPath) ||
    identityHash(group.coverage.map((scope) => scope.mediaId)) !==
      identityHash([...entry.mediaIds].sort())
  )
    throw new Error("Acquisition Plex receipt FilePlan physical group changed");
}

/** Exact completed-command readback before configuration, reservations, or fresh authority. */
export async function readCompletedAcquisitionPlexPublication(
  tx: Prisma.TransactionClient,
  rawInput: AcquisitionPlexPublicationInput,
  budget = new PublicationAuthorityReadBudget(),
): Promise<{ status: "available"; reason: null } | null> {
  const input = AcquisitionPlexPublicationInputSchema.parse(rawInput);
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  budget.consume(1);
  const marker = acquisitionPlexReceiptMarker(operation.result);
  if (marker === null) return null;
  const envelope = AcquisitionPlexPublicationEnvelopeSchema.parse(marker.raw);
  // Hash the literal receipt and its literal expected subtree before strict parser projections.
  if (identityHash(envelope.receipt) !== envelope.receiptHash)
    throw new Error("Acquisition Plex receipt raw hash changed");
  const literal = z
    .object({
      expected: z.json(),
      completion: z.object({ expectedHash: z.string() }),
    })
    .parse(envelope.receipt);
  if (identityHash(literal.expected) !== literal.completion.expectedHash)
    throw new Error("Acquisition Plex receipt raw expected hash changed");
  const receipt = parsePlexRecord(
    DefaultAcquisitionPlexReceiptSchema,
    envelope.receipt,
    envelope.receiptHash,
  );
  if (receipt.schemaVersion !== marker.version)
    throw new Error("Acquisition Plex receipt family changed");
  if (identityHash(receipt.input) !== identityHash(input))
    throw new Error(
      "Acquisition Plex receipt raw input or expected hash changed",
    );
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
  });
  assertReceiptParents(receipt, operation, attempt);
  await assertAcquisitionPlexEvidence(tx, receipt);
  return { status: "available", reason: null };
}

/** After all ordinary availability/notification effects, in the SAME final binding transaction. */
export async function recordCompletedAcquisitionPlexPublication(
  tx: Prisma.TransactionClient,
  input: {
    input: AcquisitionPlexPublicationInput;
    expected: PlexBindingExpected;
    bindings: PlexBindingSnapshot[];
    verified: VerifiedServingPlex;
  },
  budget = new PublicationAuthorityReadBudget(),
): Promise<void> {
  const { freshness } = input.verified;
  freshness.assertActive();
  const command = AcquisitionPlexPublicationInputSchema.parse(input.input);
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: command.operationId },
  });
  budget.consume(1);
  freshness.assertActive();
  const attempt = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: command.attemptId },
  });
  freshness.assertActive();
  const managed = managedSeriesIdentity(attempt.identityEvidence) !== null;
  const receipt = DefaultAcquisitionPlexReceiptSchema.parse({
    schemaVersion: managed ? 2 : 1,
    input: command,
    command: commandParent(operation),
    attempt: attemptParent(attempt),
    expected: input.expected,
    completion: {
      schemaVersion: 1,
      operationId: command.operationId,
      recoveryEpoch: attempt.recoveryEpoch,
      expectedHash: identityHash(input.expected),
      inputHash: identityHash(command),
      verification: input.verified.verification,
      bindings: input.bindings,
      bindingCount: input.bindings.length,
      committedAt: new Date().toISOString(),
    },
  });
  assertReceiptParents(receipt, operation, attempt);
  await assertAcquisitionPlexEvidence(tx, receipt);
  freshness.assertActive();
  await bindPlexTransactionDeadline(tx, freshness);
  const envelope = {
    receiptHash: identityHash(receipt),
    receipt: z.json().parse(receipt),
  };
  const marker = managed
    ? "managedEpisodePlexReceiptV2"
    : "acquisitionPlexReceipt";
  const count =
    await tx.$executeRaw`UPDATE "Operation" SET result=COALESCE(result,'{}'::jsonb) || jsonb_build_object(${marker}::text,${JSON.stringify(envelope)}::jsonb)
    WHERE id=${operation.id} AND NOT (COALESCE(result,'{}'::jsonb) ?| ARRAY['acquisitionPlexReceipt','managedEpisodePlexReceiptV2'])`;
  freshness.assertActive();
  if (count !== 1)
    throw new Error("Acquisition Plex completion was already recorded");
  const stored = await tx.operation.findUniqueOrThrow({
    where: { id: operation.id },
    select: { result: true },
  });
  budget.consume(1);
  freshness.assertActive();
  if (
    identityHash(
      z.record(z.string(), z.json()).parse(stored.result)[marker],
    ) !== identityHash(envelope)
  )
    throw new Error("Acquisition Plex receipt insert changed");
}
