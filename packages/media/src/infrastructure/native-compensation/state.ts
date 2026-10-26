import type { Prisma } from "#generated/prisma/client.ts";
import type { NativeCompensationActivityInput } from "#shared/native-recovery/compensation-runtime.ts";
import { NativeCompensationContinuationViewSchema } from "#shared/native-recovery/compensation-runtime.ts";
import { assertNativeCompensation } from "./guards.ts";
import { assertCompensatedPublication } from "./publication.ts";
import { compensationRecord } from "./records.ts";
import { NativeCompensationProtection } from "./protection.ts";
import { readVerifiedCompensationPublication } from "./publication-receipt.ts";
import { z } from "zod";
import { NativeCompensationActivityInputSchema } from "#shared/native-recovery/compensation-runtime.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

/** Negative terminal lookup grants nothing; only a positive terminal is fully validated for exact ACK. */
export async function readCompletedNativeCompensationState(
  tx: Prisma.TransactionClient,
  input: NativeCompensationActivityInput,
  budget = new PublicationAuthorityReadBudget(),
) {
  const row =
    await tx.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: input.continuationId },
      select: {
        completion: true,
        verifiedPublication: true,
        coordinatorOperationId: true,
        publicationCoordinatorOperationId: true,
      },
    });
  budget.consume(1);
  const completed =
    row.coordinatorOperationId === input.operationId && row.completion !== null;
  const published =
    row.publicationCoordinatorOperationId === input.operationId &&
    row.verifiedPublication !== null;
  return !completed && !published
    ? null
    : readNativeCompensationState(tx, input, budget);
}

export async function readNativeCompensationState(
  tx: Prisma.TransactionClient,
  input: NativeCompensationActivityInput,
  budget = new PublicationAuthorityReadBudget(),
) {
  const record = await compensationRecord(tx, input.continuationId, budget);
  if (
    record.row.verifiedPublication !== null &&
    record.row.publicationCoordinatorOperationId === input.operationId
  ) {
    const committed = await readVerifiedCompensationPublication(
      tx,
      input,
      budget,
    );
    return {
      state: NativeCompensationContinuationViewSchema.shape.state.parse(
        record.row.state,
      ),
      publicationVerified: committed !== null,
    };
  }
  if (record.row.publicationCoordinatorOperationId === input.operationId) {
    const authority = await assertCompensatedPublication(tx, input, budget);
    return {
      state: NativeCompensationContinuationViewSchema.shape.state.parse(
        record.row.state,
      ),
      publicationVerified: authority.verifiedPublication !== null,
    };
  }
  if (record.row.coordinatorOperationId !== input.operationId)
    throw new NativeCompensationProtection(
      "compensation_state_coordinator_changed",
    );
  if (record.completion !== null) {
    const operation = await tx.operation.findUniqueOrThrow({
      where: { id: input.operationId },
    });
    budget.consume(1);
    const payload = z
      .strictObject({
        ...NativeCompensationActivityInputSchema.shape,
        kind: z.literal("compensate_native_publication"),
      })
      .parse(operation.payload);
    const { kind: _kind, ...activity } = payload;
    if (
      operation.kind !== "compensate_native_publication" ||
      operation.targetId !== record.row.id ||
      operation.userId !== record.row.receipt.actorId ||
      snapshotHash(activity) !== snapshotHash(input) ||
      input.recoveryEpoch !== record.row.recoveryEpoch
    )
      throw new NativeCompensationProtection(
        "compensation_state_coordinator_changed",
      );
    const verified =
      record.row.publicationCoordinatorOperationId === null
        ? null
        : await readVerifiedCompensationPublication(
            tx,
            {
              ...input,
              operationId: record.row.publicationCoordinatorOperationId,
            },
            budget,
          );
    return {
      state: NativeCompensationContinuationViewSchema.shape.state.parse(
        record.row.state,
      ),
      publicationVerified: verified !== null,
    };
  }
  await assertNativeCompensation(tx, input, budget);
  if (record.row.verifiedPublication !== null) {
    if (record.row.publicationCoordinatorOperationId === null)
      throw new Error("Verified compensation publication coordinator missing");
    const publication = await assertCompensatedPublication(
      tx,
      {
        ...input,
        operationId: record.row.publicationCoordinatorOperationId,
      },
      budget,
    );
    return {
      state: NativeCompensationContinuationViewSchema.shape.state.parse(
        record.row.state,
      ),
      publicationVerified: publication.verifiedPublication !== null,
    };
  }
  return {
    state: NativeCompensationContinuationViewSchema.shape.state.parse(
      record.row.state,
    ),
    publicationVerified: false,
  };
}
