import { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import { snapshotHash } from "#migration/profile-import.ts";

/** Read-only group closure belongs below routing and its publication producers. */
export async function compensationGroupMedia(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
): Promise<string[]> {
  let ids = [...new Set(mediaIds)].sort();
  for (let depth = 0; depth < 100; depth++) {
    const rows = await tx.nativePublicationCompensationContinuation.findMany({
      where: {
        fenceRelease: { equals: Prisma.DbNull },
        mediaIds: { hasSome: ids },
      },
      select: { mediaIds: true },
      take: 101,
    });
    if (rows.length > 100)
      throw new Error("Compensation group history exceeds bound");
    const expanded = [
      ...new Set([...ids, ...rows.flatMap((row) => row.mediaIds)]),
    ].sort();
    if (expanded.length === ids.length) return ids;
    ids = expanded;
  }
  throw new Error("Compensation group closure exceeds bound");
}

export async function assertCompensationGroupUnchanged(
  tx: Prisma.TransactionClient,
  original: readonly string[],
  locked: readonly string[],
): Promise<void> {
  if (
    snapshotHash(await compensationGroupMedia(tx, original)) !==
    snapshotHash([...locked].sort())
  )
    throw new MediaError(
      "compensation_group_changed",
      "The shared recovery group changed; refresh before retrying",
      409,
    );
}
