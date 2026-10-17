import { Prisma } from "#generated/prisma/client.ts";

/** Root cancellation removes authority immediately, before paginated cleanup. */
export const effectiveRequestWhere = {
  active: true,
  excluded: false,
  OR: [
    { direct: true },
    {
      coverageSources: {
        some: {
          active: true,
          rootRequest: { active: true, excluded: false, direct: true },
        },
      },
    },
  ],
} satisfies Prisma.MediaRequestWhereInput;

/** Acquire after sorted leaf MediaItem locks; never acquire parent media here. */
export async function lockEffectiveRequests(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
): Promise<void> {
  if (mediaIds.length === 0) return;
  await tx.$queryRaw(Prisma.sql`
    SELECT r.id FROM "MediaRequest" r WHERE r."mediaId" IN (${Prisma.join(mediaIds)})
    OR r.id IN (SELECT c."rootRequestId" FROM "RequestCoverage" c WHERE c."mediaId" IN (${Prisma.join(mediaIds)}))
    ORDER BY r.id FOR SHARE
  `);
}
