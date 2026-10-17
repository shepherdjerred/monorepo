import { Prisma } from "#generated/prisma/client.ts";
import type { NativeCompensationActivityInput } from "#shared/native-recovery/compensation-runtime.ts";
import { compensationAncestors } from "./records.ts";
import { NativeCompensationProtection } from "./protection.ts";

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
): Promise<void> {
  const chain = await compensationAncestors(tx, input.activity.continuationId);
  const current = chain[0];
  if (current === undefined)
    throw new Error("Compensation fence owner missing");
  const coordinator =
    input.purpose === "compensate"
      ? current.row.coordinatorOperationId
      : current.row.publicationCoordinatorOperationId;
  if (
    coordinator !== input.activity.operationId ||
    current.row.recoveryEpoch !== input.activity.recoveryEpoch ||
    current.row.fenceRelease !== null
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
    take: 101,
  });
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
