import type { Prisma } from "#generated/prisma/client/index.js";
import type { Db, ExtendedPrismaClient } from "#src/database/index.ts";

/**
 * Removing Explore images.
 *
 * Objects are deleted through the support job queue's `DELETE_OBJECT` jobs:
 * the images live in the support bucket, and those jobs already retry with a
 * stable key and are drained on a schedule. A row is deleted in the same
 * transaction that queues its object, so nothing is left untracked.
 */

/** Unsent uploads older than this were abandoned in the composer. */
const UNSENT_TTL_MS = 24 * 60 * 60_000;
const SWEEP_BATCH = 50;

export async function queueExploreAttachmentDeletion(
  tx: Db,
  where: Prisma.ExploreAttachmentWhereInput,
): Promise<number> {
  const rows = await tx.exploreAttachment.findMany({
    where,
    select: { id: true, objectKey: true },
  });
  for (const row of rows) {
    await tx.supportJob.upsert({
      where: { id: `delete:explore:${row.id}` },
      create: {
        id: `delete:explore:${row.id}`,
        kind: "DELETE_OBJECT",
        objectKey: row.objectKey,
      },
      update: {},
    });
  }
  if (rows.length > 0)
    await tx.exploreAttachment.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
  return rows.length;
}

/** Queue the objects of uploads nobody sent. Run before the support drain. */
export async function collectUnsentExploreAttachments(
  db: ExtendedPrismaClient,
  now: Date = new Date(),
): Promise<number> {
  const stale = await db.exploreAttachment.findMany({
    where: {
      questionId: null,
      createdAt: { lt: new Date(now.getTime() - UNSENT_TTL_MS) },
    },
    select: { id: true },
    take: SWEEP_BATCH,
  });
  if (stale.length === 0) return 0;
  return await db.$transaction(
    async (tx) =>
      await queueExploreAttachmentDeletion(tx, {
        id: { in: stale.map((row) => row.id) },
        questionId: null,
      }),
  );
}
