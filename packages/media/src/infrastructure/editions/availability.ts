import type { Availability, Prisma } from "#generated/prisma/client.ts";

/** Caller holds canonical/target locks and retains its original MediaItem CAS. */
export async function mirrorDefaultAvailability(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
  availability: Availability,
): Promise<void> {
  const ids = [...new Set(mediaIds)];
  if (ids.length === 0) return;
  const result = await tx.mediaIntent.updateMany({
    where: { mediaId: { in: ids }, edition: "default" },
    data: { availability },
  });
  if (result.count !== ids.length)
    throw new Error("Availability mirror requires every default media target");
}
