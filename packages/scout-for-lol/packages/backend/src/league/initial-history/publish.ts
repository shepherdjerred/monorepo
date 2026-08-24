import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { initialHistoryImportPhasesTotal } from "#src/metrics/initial-history-import.ts";
import { runReportLakeFold } from "#src/report-lake/compactor.ts";

export async function publishReadyImports(
  db: ExtendedPrismaClient,
  now: Date,
): Promise<void> {
  const jobs = await db.initialMatchHistoryImport.findMany({
    where: { phase: "publish", nextAttemptAt: { lte: now } },
    orderBy: [{ requestedAt: "asc" }],
  });
  if (jobs.length === 0) return;

  const accounts = await db.account.findMany({
    where: { puuid: { in: jobs.map((job) => job.puuid) } },
    select: { puuid: true },
    distinct: ["puuid"],
  });
  const trackedPuuids = new Set(accounts.map((account) => account.puuid));
  const abandoned = jobs.filter((job) => !trackedPuuids.has(job.puuid));
  if (abandoned.length > 0) {
    await db.initialMatchHistoryImport.updateMany({
      where: { puuid: { in: abandoned.map((job) => job.puuid) } },
      data: { phase: "complete", errorCode: "untracked", completedAt: now },
    });
  }

  const ready = jobs.filter((job) => trackedPuuids.has(job.puuid));
  if (ready.length === 0) return;
  const summary = await runReportLakeFold({ prisma: db });
  if (summary === null) return;

  const completions = await Promise.all(
    ready.map(
      async (job) =>
        await db.initialMatchHistoryImport.updateMany({
          where: {
            puuid: job.puuid,
            phase: "publish",
            requestedAt: job.requestedAt,
          },
          data: {
            phase: "complete",
            errorCode: null,
            completedAt: now,
            lastAttemptAt: now,
          },
        }),
    ),
  );
  const completedCount = completions.reduce(
    (total, result) => total + result.count,
    0,
  );
  initialHistoryImportPhasesTotal.inc(
    { phase: "publish", outcome: "complete" },
    completedCount,
  );
}
