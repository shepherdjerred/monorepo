import { Prisma } from "#generated/prisma/client.ts";
import type { NativeCompensationActivityInput } from "#shared/native-recovery/compensation-runtime.ts";
import { compensationAncestors } from "./records.ts";
import { NativeCompensationProtection } from "./protection.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";

/** Called only after canonical media/target locks; this is an effect fence, not read authority. */
export async function assertNoPublicationCompensationFence(
  tx: Prisma.TransactionClient,
  input: {
    mediaIds: readonly string[];
    assetIds?: readonly string[];
  },
): Promise<void> {
  if (
    await tx.nativePublicationCompensationContinuation.count({
      where: {
        fenceRelease: { equals: Prisma.DbNull },
        OR: [
          { mediaIds: { hasSome: [...input.mediaIds] } },
          { assetIds: { hasSome: [...(input.assetIds ?? [])] } },
        ],
      },
    })
  )
    throw new NativeCompensationProtection(
      "publication_compensation_fence_active",
    );
}

export async function assertCompensationFenceOwner(
  tx: Prisma.TransactionClient,
  input: {
    activity: NativeCompensationActivityInput;
    purpose: "compensate" | "publish";
  },
  budget = new PublicationAuthorityReadBudget(),
): Promise<void> {
  const chain = await compensationAncestors(
    tx,
    input.activity.continuationId,
    budget,
  );
  return assertValidatedCompensationFenceOwner(tx, input, chain, budget);
}

/** Internal same-TX use only: caller just validated this entire queried immutable chain under its locks. */
export async function assertValidatedCompensationFenceOwner(
  tx: Prisma.TransactionClient,
  input: {
    activity: NativeCompensationActivityInput;
    purpose: "compensate" | "publish";
  },
  chain: Awaited<ReturnType<typeof compensationAncestors>>,
  budget: PublicationAuthorityReadBudget,
): Promise<void> {
  const current = chain[0];
  if (current === undefined)
    throw new Error("Compensation fence owner missing");
  const latest =
    await tx.nativePublicationCompensationContinuation.findUniqueOrThrow({
      where: { id: current.row.id },
    });
  budget.consume(1);
  if (
    latest.descriptorHash !== current.row.descriptorHash ||
    latest.version !== current.row.version ||
    latest.id !== input.activity.continuationId ||
    latest.receiptId !== current.row.receiptId ||
    latest.transitionId !== current.row.transitionId ||
    identityHash(latest.mediaIds) !== identityHash(current.row.mediaIds) ||
    identityHash(latest.assetIds) !== identityHash(current.row.assetIds)
  )
    throw new NativeCompensationProtection(
      "compensation_fence_coordinator_changed",
    );
  const coordinator =
    input.purpose === "compensate"
      ? latest.coordinatorOperationId
      : latest.publicationCoordinatorOperationId;
  if (
    coordinator !== input.activity.operationId ||
    latest.recoveryEpoch !== input.activity.recoveryEpoch ||
    latest.fenceRelease !== null
  )
    throw new NativeCompensationProtection(
      "compensation_fence_coordinator_changed",
    );
  const overlaps = await tx.nativePublicationCompensationContinuation.findMany({
    where: {
      fenceRelease: { equals: Prisma.DbNull },
      OR: [
        { mediaIds: { hasSome: current.row.mediaIds } },
        { assetIds: { hasSome: current.row.assetIds } },
      ],
    },
    select: { id: true },
    take: budget.take,
  });
  budget.consume(overlaps.length);
  if (
    overlaps.length > 100 ||
    overlaps.some(
      (row) => !chain.some((ancestor) => ancestor.row.id === row.id),
    )
  )
    throw new NativeCompensationProtection(
      "compensation_unrelated_fence_active",
    );
}
