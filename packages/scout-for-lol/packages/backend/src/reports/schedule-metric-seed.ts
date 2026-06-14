import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";
import { scoutScheduledReportLastSuccessTimestamp } from "#src/metrics/report-runs.ts";

const logger = createLogger("schedule-metric-seed");

// Seed the per-report "last successful scheduled run" gauge from DB on
// startup. Without this, the `ScoutScheduledReportMissed*` PagerDuty
// alerts can't fire until the next scheduled fire — which for a
// once-a-week report could be 7 days. After this seed, the alert is
// immediately accurate against historical state.
//
// Reports that have never had a successful SCHEDULED run get the gauge
// set to 0 (epoch) — `time() - 0` is huge, so the alert fires
// immediately, which is the correct signal: the report is broken.
export async function seedScheduledReportLastSuccessMetric(
  prisma: ExtendedPrismaClient,
): Promise<void> {
  const reports = await prisma.report.findMany({
    where: { isEnabled: true },
    select: { id: true, title: true, systemSource: true },
  });
  let seededWithRun = 0;
  let seededAsNeverRun = 0;
  for (const report of reports) {
    const lastSuccess = await prisma.reportRun.findFirst({
      where: {
        reportId: report.id,
        trigger: "SCHEDULED",
        status: "SUCCESS",
      },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    });
    const labels = {
      report_id: report.id.toString(),
      system_source: report.systemSource ?? "USER",
      title: report.title,
    };
    if (lastSuccess === null) {
      scoutScheduledReportLastSuccessTimestamp.set(labels, 0);
      seededAsNeverRun++;
    } else {
      scoutScheduledReportLastSuccessTimestamp.set(
        labels,
        lastSuccess.startedAt.getTime() / 1000,
      );
      seededWithRun++;
    }
  }
  logger.info(
    `[ScheduleMetricSeed] Seeded ${seededWithRun.toString()} report(s) from history, ${seededAsNeverRun.toString()} marked as never-run (will alert)`,
  );
}
