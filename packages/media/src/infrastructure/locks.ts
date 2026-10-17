import { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";

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
