import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { z } from "zod";
import { IngestionReconciliationResultSchema } from "@scout-for-lol/temporal/contracts";

export async function findPendingCustomWork(db: ExtendedPrismaClient) {
  const operations = await db.customNightOperation.findMany({
    where: { state: { in: ["queued", "running"] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 100,
    select: { id: true },
  });
  const cutover = await db.scoutOrchestrationCutover.findUnique({
    where: { id: "scout-temporal-durability-v1" },
  });
  const publications =
    cutover === null
      ? []
      : await db.$queryRaw`
    SELECT "id" AS "nightId", "revision" FROM "CustomNight" WHERE "publishedRevision" < "revision"
    ORDER BY "updatedAt", "id" LIMIT 100`;
  return IngestionReconciliationResultSchema.pick({
    customOperations: true,
    customPublications: true,
  }).parse({
    customOperations: operations.map((operation) => operation.id),
    customPublications: z
      .array(
        z.strictObject({ nightId: z.uuid(), revision: z.int().nonnegative() }),
      )
      .parse(publications),
  });
}
