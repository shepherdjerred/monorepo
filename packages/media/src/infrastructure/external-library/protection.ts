import type { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";

/** A request never turns somebody else's current library file into an upgrade target. */
export async function externalLibraryProtected(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
): Promise<boolean> {
  return (
    (await tx.assetCoverage.count({
      where: {
        mediaId: { in: [...mediaIds] },
        current: true,
        asset: { owned: false },
      },
    })) > 0
  );
}

/** Call under the acquisition's canonical locks, including every proposed pack member. */
export async function assertNoExternalLibrary(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
): Promise<void> {
  if (await externalLibraryProtected(tx, mediaIds))
    throw new MediaError(
      "external_library_protected",
      "This title has an externally managed library file",
      409,
    );
}
