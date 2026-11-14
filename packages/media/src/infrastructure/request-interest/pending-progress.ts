import { Prisma } from "#generated/prisma/client.ts";

/** Shares the collector's existing server lock. Collector never takes scope locks.
 * The checkpoint row additionally rejects an older Serializable snapshot after a
 * concurrent collection. Holding these through effect authorization linearizes
 * authorization before or after publication of the complete collected sample. */
export async function lockInterestPlayback(
  tx: Prisma.TransactionClient,
  requestIds: string[],
) {
  if (requestIds.length === 0) return true;
  const servers = await tx.plexIdentityMapping.findMany({
    where: { user: { requests: { some: { id: { in: requestIds } } } } },
    distinct: ["serverMachineId"],
    select: { serverMachineId: true },
    orderBy: { serverMachineId: "asc" },
  });
  if (servers.length === 0) return false;
  for (const { serverMachineId } of servers) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${`media-playback:${serverMachineId}`}))`;
    const checkpoints = await tx.$queryRaw<
      {
        serverMachineId: string;
        collectionStartedAt: Date | null;
        observedAt: Date | null;
      }[]
    >`SELECT "serverMachineId", "collectionStartedAt", "observedAt" FROM "PlaybackCollector" WHERE "serverMachineId"=${serverMachineId} FOR SHARE`;
    // An absent row cannot detect a collector inserted after this transaction's
    // Serializable snapshot. Unknown initial handoff must remain protected.
    if (
      checkpoints.length !== 1 ||
      checkpoints[0]?.collectionStartedAt == null ||
      checkpoints[0].observedAt === null
    )
      return false;
  }
  return true;
}

/** Conservative pending-work protection, never authority to revive a claim.
 * One EXISTS over native claims/coverage; full binding verification belongs to
 * the one-request renewal page. Stopped sessions retain their genuine progress. */
export async function hasPendingInterestProgress(
  tx: Prisma.TransactionClient,
  requestIds: string[],
  now: Date,
) {
  if (requestIds.length === 0) return false;
  if (!(await lockInterestPlayback(tx, requestIds))) return true;
  const rows = await tx.$queryRaw<{ pending: boolean }[]>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1 FROM "MediaRequest" r
      JOIN "PlexIdentityMapping" m ON m."userId"=r."userId"
      JOIN "PlaybackSession" s ON s."userId"=r."userId"
        AND s."serverMachineId"=m."serverMachineId" AND s."serverAccountId"=m."serverAccountId"
      JOIN "PlexItemClaim" c ON c."serverMachineId"=s."serverMachineId" AND c."ratingKey"=s."ratingKey" AND c.edition=r.edition
      WHERE r.id IN (${Prisma.join(requestIds)}) AND r.active AND r.direct AND NOT r.excluded
        AND r."keepingPolicy"='temporary' AND r."interestState"='expired' AND r."interestReleaseReason"='lost_interest'
        AND s.source='plex' AND s."meaningfulProgressAt" <= ${now}
        AND s."meaningfulProgressAt" > r."interestReleasedAt"
        AND s."meaningfulProgressAt" > r."interestRenewedAt"
        AND (r."lastMeaningfulProgressAt" IS NULL OR s."meaningfulProgressAt" > r."lastMeaningfulProgressAt")
        AND c."sectionId"=ANY(m."permittedSectionIds")
        AND (c."mediaId"=r."mediaId" OR EXISTS (
          SELECT 1 FROM "RequestCoverage" rc JOIN "MediaRequest" leaf ON leaf.id=rc."requestId"
          WHERE rc."rootRequestId"=r.id AND rc."mediaId"=c."mediaId" AND rc.edition=r.edition AND rc.active
            AND leaf.active AND NOT leaf.excluded AND leaf."userId"=r."userId"
        ))
    ) AS pending`);
  const result = rows[0];
  if (
    result === undefined ||
    rows.length !== 1 ||
    typeof result.pending !== "boolean"
  )
    throw new Error("Pending playback query returned an invalid result");
  return result.pending;
}
