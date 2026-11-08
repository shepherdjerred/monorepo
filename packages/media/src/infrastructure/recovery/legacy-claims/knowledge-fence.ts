import type { Prisma } from "#generated/prisma/client.ts";

async function advisory(db: Prisma.TransactionClient) {
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('media-legacy-requester-bindings', 0))::text`;
}

/** Acquire after sorted user/mapping locks, before reading selected claim knowledge. */
export async function lockLegacyClaimKnowledge(db: Prisma.TransactionClient) {
  await advisory(db);
  // Unlike an advisory lock alone, a changed row rejects an older repeatable-read
  // snapshot. Serializable command retries then rebuild the complete scope.
  const rows = await db.$queryRaw<{ version: number }[]>`
    SELECT version FROM "LegacyClaimKnowledge" WHERE id = 'singleton' FOR SHARE
  `;
  if (rows.length !== 1)
    throw new Error("Legacy claim knowledge fence missing");
}

/** Every capture/binding mutation advances this in its own atomic transaction. */
export async function advanceLegacyClaimKnowledge(
  db: Prisma.TransactionClient,
) {
  await advisory(db);
  await db.legacyClaimKnowledge.update({
    where: { id: "singleton" },
    data: { version: { increment: 1 } },
  });
}
