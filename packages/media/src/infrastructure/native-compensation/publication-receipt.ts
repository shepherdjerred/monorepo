import type { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import {
  NativeCompensationPublicationCommandSchema,
  NativeCompensationVerifiedPublicationSchema,
  NativeCompensationFenceReleaseSchema,
  type NativeCompensationActivityInput,
} from "#shared/native-recovery/compensation-runtime.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { type compensationRecord, compensationAncestors } from "./records.ts";
import { NativeCompensationProtection } from "./protection.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

/** Immutable acknowledgment only: later demand, publication and restore do not undo history. */
export async function readVerifiedCompensationPublication(
  tx: Prisma.TransactionClient,
  input: NativeCompensationActivityInput,
  budget = new PublicationAuthorityReadBudget(),
) {
  const terminal =
    await tx.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: input.continuationId },
      select: { verifiedPublication: true },
    });
  budget.consume(1);
  if (terminal.verifiedPublication === null) return null;
  const chain = await compensationAncestors(tx, input.continuationId, budget);
  const record = chain[0];
  if (record === undefined)
    throw new Error("Verified compensation chain is empty");
  const { row, completion } = record;
  if (
    row.verifiedPublication === null ||
    snapshotHash(nativeJson(row.verifiedPublication)) !==
      snapshotHash(nativeJson(terminal.verifiedPublication))
  )
    throw new Error("Verified compensation terminal projection changed");
  if (
    row.publicationCoordinatorOperationId !== input.operationId ||
    row.recoveryEpoch !== input.recoveryEpoch
  )
    throw new NativeCompensationProtection(
      "compensation_publication_coordinator_changed",
    );
  if (completion === null)
    throw new Error("Verified compensation has no physical completion");
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  budget.consume(1);
  const { proof, completionHash, bindingsHash, commandHash, command } =
    verifyPublicationCommand(record, input, operation);
  const assets = completion.predecessorBindings.map(({ after }) => ({
    assetId: after.id,
    assetVersion: after.version,
    checksum: after.checksum,
    mediaIds: after.coverage.map((item) => item.mediaId),
  }));
  if (
    proof.items.length !== row.mediaIds.length ||
    new Set(proof.items.map((item) => item.mediaId)).size !==
      row.mediaIds.length ||
    proof.items.some(
      (item) =>
        !completion.predecessorBindings.some(
          ({ after }) =>
            after.id === item.assetId &&
            after.version === item.assetVersion &&
            after.checksum === item.checksum &&
            after.path === item.canonicalPath &&
            after.coverage.some(
              (coverage) => coverage.mediaId === item.mediaId,
            ),
        ),
    )
  )
    throw new Error("Verified compensation publication coverage changed");
  for (const ancestor of chain) {
    const release = NativeCompensationFenceReleaseSchema.parse(
      ancestor.row.fenceRelease,
    );
    if (
      release.continuationId !== ancestor.row.id ||
      release.transitionId !== ancestor.row.transitionId ||
      release.settlingContinuationId !== row.id ||
      release.settlingCompletionHash !== completionHash ||
      release.publicationHash !== snapshotHash(nativeJson(proof))
    )
      throw new Error("Compensation fence release proof changed");
  }
  return {
    continuationId: row.id,
    publicationOperationId: input.operationId,
    recoveryEpoch: row.recoveryEpoch,
    completionHash,
    commandHash,
    bindingsHash,
    generations: command.generations,
    mediaIds: row.mediaIds,
    assets,
    ancestorFenceIds: chain.map((item) => item.row.id),
    verifiedPublication: proof,
  };
}

function verifyPublicationCommand(
  record: Awaited<ReturnType<typeof compensationRecord>>,
  input: NativeCompensationActivityInput,
  operation: Prisma.OperationGetPayload<Record<string, never>>,
) {
  const { row, completion } = record;
  if (completion === null)
    throw new Error("Verified compensation has no physical completion");
  const payload = NativeCompensationPublicationCommandSchema.extend({
    operationId: z.uuid(),
    kind: z.literal("publish_compensated_media"),
  }).parse(operation.payload);
  const { operationId, kind: _kind, ...command } = payload;
  const proof = NativeCompensationVerifiedPublicationSchema.parse(
    row.verifiedPublication,
  );
  const completionHash = snapshotHash(nativeJson(completion));
  const bindingsHash = snapshotHash(nativeJson(completion.predecessorBindings));
  const commandHash = snapshotHash(command);
  if (
    operation.kind !== "publish_compensated_media" ||
    operation.targetId !== row.id ||
    operation.userId !== row.receipt.actorId ||
    operationId !== input.operationId ||
    command.continuationId !== row.id ||
    command.recoveryEpoch !== row.recoveryEpoch ||
    command.completionHash !== completionHash ||
    command.bindingsHash !== bindingsHash ||
    proof.continuationId !== row.id ||
    proof.operationId !== input.operationId ||
    proof.recoveryEpoch !== row.recoveryEpoch ||
    proof.completionHash !== completionHash ||
    proof.commandHash !== commandHash ||
    proof.bindingsHash !== bindingsHash ||
    snapshotHash(proof.generations) !== snapshotHash(command.generations)
  )
    throw new Error("Verified compensation publication receipt changed");
  return { proof, completionHash, bindingsHash, commandHash, command };
}
