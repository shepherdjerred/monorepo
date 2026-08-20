import type { Report } from "@scout-for-lol/data";
import { computeNextScheduledUpdateAt } from "@scout-for-lol/data/model/competition-cron.ts";
import * as Sentry from "@sentry/bun";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  scheduledReportCompileFailuresTotal,
  scheduledReportsActive,
  scheduledReportsDueTotal,
} from "#src/metrics/report-runs.ts";
import { REPORT_WINDOW_REQUIRED_MESSAGE } from "@scout-for-lol/data";
import { runReport, type ReportRunResult } from "#src/reports/runner.ts";
import { createLogger } from "#src/logger.ts";

/**
 * Whether a run failed because its stored ScoutQL no longer parses or compiles,
 * as opposed to a lake, Discord, or database fault.
 *
 * Matched on the compiler's own messages rather than an error subclass because
 * `parseAndCompile` throws plain Errors from a dozen validation sites; adding a
 * class hierarchy for one counter would be a larger change than the counter
 * justifies.
 */
function isReportCompileFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message === REPORT_WINDOW_REQUIRED_MESSAGE ||
    error.message.startsWith("Invalid report query") ||
    error.message.startsWith("Invalid DURING clause") ||
    error.message.startsWith("Unknown GROUP BY field")
  );
}

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
  if (reports.length > 0) {
    logger.info(
      `[ReportScheduler] Found ${reports.length.toString()} due report(s)`,
    );
  }
  const dispatched: ScheduledReportDispatch[] = [];
  let earlyFailures = 0;

  for (const report of reports) {
    const scheduledAt = report.nextScheduledRunAt ?? now;
    const localDate = scheduledLocalDate(scheduledAt, report.scheduleTimezone);
    const claim = await params.prisma.report.updateMany({
      where: {
        id: report.id,
        OR: [
          { lastScheduledLocalDate: null },
          { lastScheduledLocalDate: { not: localDate } },
        ],
      },
      data: { lastScheduledLocalDate: localDate },
    });
    if (claim.count === 0) {
      logger.warn(
        `[ReportScheduler] Suppressed duplicate local-date run for report ${report.id.toString()} on ${localDate}`,
      );
      await params.prisma.report.update({
        where: { id: report.id },
        data: {
          nextScheduledRunAt: computeNextScheduledUpdateAt(
            report.cronExpression,
            now,
            report.scheduleTimezone,
          ),
          updatedTime: new Date(),
        },
      });
      continue;
    }
    try {
      const result = await runReport({
        prisma: params.prisma,
        report,
        trigger: "SCHEDULED",
        now,
      });
      dispatched.push({ report, result });
    } catch (error) {
      earlyFailures++;
      // A stored query that no longer compiles is its own failure mode: the
      // catch below advances the schedule regardless, so without this counter
      // a language change that broke every saved report would be invisible.
      if (isReportCompileFailure(error)) {
        scheduledReportCompileFailuresTotal.inc({
          system_source: report.systemSource ?? "USER",
        });
      }
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
        report.scheduleTimezone,
      );
      // Always set `lastScheduledRunAt = now` even if `runReport` threw
      // before reaching `runner.ts`'s success/failure branches — that's
      // the only signal the staleness alert has that the dispatcher
      // actually attempted this fire.
      await params.prisma.report.update({
        where: { id: report.id },
        data: {
          nextScheduledRunAt,
          lastScheduledRunAt: now,
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

  if (reports.length > 0) {
    logger.info(
      `[ReportScheduler] Dispatched ${dispatched.length.toString()}, early-failed ${earlyFailures.toString()} of ${reports.length.toString()}`,
    );
  }

  return dispatched;
}

export function scheduledLocalDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Unable to resolve scheduled date in ${timezone}`);
  }
  return `${year}-${month}-${day}`;
}
