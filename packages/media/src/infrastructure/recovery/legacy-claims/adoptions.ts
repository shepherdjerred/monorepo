import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

/** Caller holds LegacyClaimKnowledge in this transaction. Every relevant event
 * participates in the bounded input, including malformed/null references. Only
 * distinct literal plan locators leave SQL; each is paid, and grants nothing
 * until its actual immutable plan/report and current claim graph are read.
 */
export async function paidAdoptionPlanLocatorsV1(
  tx: Prisma.TransactionClient,
  ids: readonly string[],
  budget: PublicationAuthorityReadBudget,
) {
  const rows = await tx.$queryRaw<
    { planId: unknown; eventCount: number }[]
  >(Prisma.sql`
    WITH relevant AS (
      SELECT e.payload FROM "ApplicationEvent" e
      WHERE e.kind = 'handoff_media_adopted' AND e."mediaId" IN (${Prisma.join(ids)})
      ORDER BY e.id LIMIT 1001
    )
    SELECT DISTINCT r.payload->'planId' AS "planId",
      (SELECT count(*)::int FROM relevant) AS "eventCount"
    FROM relevant r ORDER BY "planId" LIMIT ${budget.take}
  `);
  budget.consume(rows.length);
  if (rows.some((row) => row.eventCount > 1000))
    return { planIds: [], exhausted: true };
  return {
    planIds: rows.map((row) => z.uuid().parse(row.planId)),
    exhausted: false,
  };
}
