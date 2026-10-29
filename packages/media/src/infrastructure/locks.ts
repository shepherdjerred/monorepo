import { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import type { Database } from "./database.ts";

const WriteConflictSchema = z.object({
  driverAdapterError: z.object({
    cause: z.object({ kind: z.literal("TransactionWriteConflict") }),
  }),
});

export function isRetryableTransaction(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2034" ||
      error.code === "P2002" ||
      (error.code === "P2010" &&
        WriteConflictSchema.safeParse(error.meta).success))
  );
}

/** Read-only views can race fresh authentication writes before their row locks.
 * Retry expected snapshot conflicts without changing isolation or transaction timeouts.
 */
export async function repeatableRead<T>(
  db: Database,
  read: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.$transaction(read, { isolationLevel: "RepeatableRead" });
    } catch (error) {
      if (isRetryableTransaction(error) && attempt < 3) continue;
      throw error;
    }
  }
  throw new Error("Read transaction retry bound was not enforced");
}

/** Same sorted row lock order used by filesystem final guards. Acquire before related writes. */
export async function lockMedia(
  db: Prisma.TransactionClient,
  mediaIds: readonly string[],
): Promise<void> {
  const ordered = [...new Set(mediaIds)].sort();
  if (ordered.length === 0) return;
  await db.$queryRaw(
    Prisma.sql`SELECT id FROM "MediaItem" WHERE id IN (${Prisma.join(ordered)}) ORDER BY id FOR UPDATE`,
  );
}

export async function needsRestore(
  db: Prisma.TransactionClient,
  mediaId: string,
): Promise<boolean> {
  const decision = await db.retentionDecision.findFirst({
    where: {
      edition: "default",
      mediaId,
      state: { in: ["grace_period", "cancelled", "quarantined"] },
      manifest: { not: Prisma.DbNull },
    },
  });
  return decision !== null;
}
