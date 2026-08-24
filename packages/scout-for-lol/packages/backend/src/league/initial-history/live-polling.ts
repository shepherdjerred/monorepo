import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";

type InitialHistoryReadClient = Pick<
  ExtendedPrismaClient,
  "initialMatchHistoryImport"
>;

export async function getPuuidsBlockedFromLivePolling(
  db: InitialHistoryReadClient = prisma,
): Promise<Set<string>> {
  const jobs = await db.initialMatchHistoryImport.findMany({
    where: {
      OR: [
        { phase: { in: ["queued", "matches"] } },
        { phase: "failed", cursorHandedOffAt: null },
      ],
    },
    select: { puuid: true },
  });
  return new Set(jobs.map((job) => job.puuid));
}
