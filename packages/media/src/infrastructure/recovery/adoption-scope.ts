import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { paidAdoptionPlanLocatorsV1 } from "./legacy-claims/adoptions.ts";

/** Operational protocol selection grants nothing. Actual new native receipt
 * and literal plan/report authority is independently read and paid by callers. */
export async function recoveryAdoptionScopeV1(
  db: Prisma.TransactionClient,
  input: { ids: string[]; assetIds: string[]; epoch: number },
  budget?: PublicationAuthorityReadBudget,
) {
  if (budget !== undefined) {
    const count = await db.nativePublicationCompensationContinuation.count({
      where: {
        state: "compensated",
        recoveryEpoch: input.epoch,
        assetIds: { hasSome: input.assetIds },
        descriptor: { path: ["schemaVersion"], equals: 2 },
      },
    });
    if (count > 0)
      return {
        ...(await paidAdoptionPlanLocatorsV1(db, input.ids, budget)),
        nativeBudget: budget,
      };
  }
  const adoptions = await db.applicationEvent.findMany({
    where: { mediaId: { in: input.ids }, kind: "handoff_media_adopted" },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  const planIds = adoptions.map(
    (row) => z.object({ planId: z.uuid() }).parse(row.payload).planId,
  );
  return {
    planIds,
    exhausted: adoptions.length === 1000,
    nativeBudget: undefined,
  };
}
