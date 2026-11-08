import type { Prisma } from "#generated/prisma/client.ts";

/** Inventory-only reads, at the caller's existing point in its transaction. */
export async function nativeInventoryContext(tx: Prisma.TransactionClient) {
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const restore = await tx.operation.findFirst({
    where: {
      kind: "restore_observe",
      status: "completed",
      result: { path: ["recoveryEpoch"], equals: runtime.recoveryEpoch },
    },
    orderBy: { createdAt: "desc" },
  });
  return { runtime, restore };
}
