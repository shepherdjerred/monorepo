import type { Report } from "@scout-for-lol/data";
import { computeNextScheduledUpdateAt } from "@scout-for-lol/data/model/competition-cron.ts";
import * as Sentry from "@sentry/bun";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  scheduledReportsActive,
  scheduledReportsDueTotal,
} from "#src/metrics/report-runs.ts";
import { runReport, type ReportRunResult } from "#src/reports/runner.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("report-scheduler");

export type ScheduledReportDispatch = {
  report: Report;
  result: ReportRunResult;
};

type RunDueReportsParams = {
  prisma: ExtendedPrismaClient;
  now?: Date;
  limit?: number;
};

export async function getDueReports(
  prisma: ExtendedPrismaClient,
  now: Date,
  limit: number,
): Promise<Report[]> {
  return await prisma.report.findMany({
    where: {
      isEnabled: true,
      OR: [{ nextScheduledRunAt: null }, { nextScheduledRunAt: { lte: now } }],
    },
    orderBy: [{ nextScheduledRunAt: "asc" }, { id: "asc" }],
    take: limit,
  });
}

export async function runDueReports(
  params: RunDueReportsParams,
): Promise<ScheduledReportDispatch[]> {
  const now = params.now ?? new Date();
  const limit = params.limit ?? 10;
  const activeReports = await params.prisma.report.count({
    where: { isEnabled: true },
  });
  scheduledReportsActive.set(activeReports);
  const reports = await getDueReports(params.prisma, now, limit);
  scheduledReportsDueTotal.inc(reports.length);
  const dispatched: ScheduledReportDispatch[] = [];

  for (const report of reports) {
    try {
      const result = await runReport({
        prisma: params.prisma,
        report,
        trigger: "SCHEDULED",
        now,
      });
      dispatched.push({ report, result });
    } catch (error) {
      logger.error(
        `[ReportScheduler] Failed to run report ${report.id.toString()}:`,
        error,
      );
      Sentry.captureException(error, {
        tags: {
          source: "scheduled-report",
          reportId: report.id.toString(),
          serverId: report.serverId,
          systemSource: report.systemSource ?? "USER",
        },
      });
    } finally {
      const nextScheduledRunAt = computeNextScheduledUpdateAt(
        report.cronExpression,
        now,
      );
      await params.prisma.report.update({
        where: { id: report.id },
        data: {
          nextScheduledRunAt,
          updatedTime: new Date(),
        },
      });
      if (report.sourceCompetitionId !== null) {
        await params.prisma.competition.update({
          where: { id: report.sourceCompetitionId },
          data: {
            nextScheduledUpdateAt: nextScheduledRunAt,
            lastScheduledUpdateAt: now,
          },
        });
      }
    }
  }

  return dispatched;
}
