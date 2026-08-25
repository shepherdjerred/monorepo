import {
  ReportIdSchema,
  type Report,
  type ReportRunId,
} from "@scout-for-lol/data";
import { computeNextScheduledUpdateAt } from "@scout-for-lol/data/model/competition-cron.ts";
import * as Sentry from "@sentry/bun";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  scheduledReportCompileFailuresTotal,
  scheduledReportsActive,
  scheduledReportsDueTotal,
} from "#src/metrics/report-runs.ts";
import { compileScoutQl } from "@scout-for-lol/data/model/scoutql/compile.ts";
import { runReport, type ReportRunResult } from "#src/reports/runner.ts";
import { createLogger } from "#src/logger.ts";

/**
 * Whether a run failed because its stored ScoutQL no longer compiles, as
 * opposed to a lake, Discord, or database fault.
 *
 * Decided by re-compiling the stored text rather than by matching message
 * prefixes. `compileScoutQl` throws from a dozen validation
 * sites, so any prefix list silently undercounts the moment a new one is
 * added — and undercounting is the whole failure mode this metric exists to
 * make visible.
 */
function isReportCompileFailure(queryText: string): boolean {
  try {
    compileScoutQl(queryText);
    return false;
  } catch {
    return true;
  }
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
  reportId?: number;
};

type ScheduledReportClaim = {
  report: Report;
  runId: ReportRunId;
  status: string;
  isNew: boolean;
};

type RunScheduledReportOccurrenceParams = {
  prisma: ExtendedPrismaClient;
  report: Report;
  workflowRunId: string;
  now?: Date;
};

export async function getDueReports(
  prisma: ExtendedPrismaClient,
  now: Date,
  limit: number,
  reportId?: number,
): Promise<Report[]> {
  return await prisma.report.findMany({
    where: {
      ...(reportId === undefined ? {} : { id: ReportIdSchema.parse(reportId) }),
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
  const reports = await getDueReports(
    params.prisma,
    now,
    limit,
    params.reportId,
  );
  scheduledReportsDueTotal.inc(reports.length);
  if (reports.length > 0) {
    logger.info(
      `[ReportScheduler] Found ${reports.length.toString()} due report(s)`,
    );
  }
  const dispatched: ScheduledReportDispatch[] = [];
  let earlyFailures = 0;

  for (const report of reports) {
    const claim = await claimScheduledReport({
      prisma: params.prisma,
      report,
      now,
    });
    if (claim === null) continue;
    try {
      const result = await executeScheduledReportClaim(params.prisma, claim);
      dispatched.push({ report, result });
    } catch (error) {
      earlyFailures++;
      recordScheduledReportFailure(report, error);
    }
  }

  if (reports.length > 0) {
    logger.info(
      `[ReportScheduler] Dispatched ${dispatched.length.toString()}, early-failed ${earlyFailures.toString()} of ${reports.length.toString()}`,
    );
  }

  return dispatched;
}

/**
 * Run one Temporal Schedule occurrence. The Temporal Workflow Run ID is the
 * durable idempotency key: the due-time cursor and RUNNING ReportRun are
 * committed together, so an Activity retry resumes the claimed row instead of
 * observing the advanced cursor and silently returning.
 */
export async function runScheduledReportOccurrence(
  params: RunScheduledReportOccurrenceParams,
): Promise<number | null> {
  scheduledReportsActive.set(
    await params.prisma.report.count({ where: { isEnabled: true } }),
  );
  const now = params.now ?? new Date();
  const claim = await claimScheduledReport({
    prisma: params.prisma,
    report: params.report,
    now,
    workflowRunId: params.workflowRunId,
  });
  if (claim === null) return null;
  if (claim.isNew) scheduledReportsDueTotal.inc();
  if (claim.status === "SUCCESS") return claim.runId;
  try {
    await executeScheduledReportClaim(params.prisma, claim);
    return claim.runId;
  } catch (error) {
    recordScheduledReportFailure(claim.report, error);
    throw error;
  }
}

async function claimScheduledReport(params: {
  prisma: ExtendedPrismaClient;
  report: Report;
  now: Date;
  workflowRunId?: string;
}): Promise<ScheduledReportClaim | null> {
  if (params.workflowRunId !== undefined) {
    const existing = await params.prisma.reportRun.findUnique({
      where: { temporalWorkflowRunId: params.workflowRunId },
    });
    if (existing !== null) {
      if (
        existing.reportId !== params.report.id ||
        existing.trigger !== "SCHEDULED"
      ) {
        throw new Error(
          `Temporal Workflow Run ${params.workflowRunId} is already bound to an incompatible report execution`,
        );
      }
      return {
        report: params.report,
        runId: existing.id,
        status: existing.status,
        isNew: false,
      };
    }
  }

  const scheduledAt = params.report.nextScheduledRunAt ?? params.now;
  const localDate = scheduledLocalDate(
    scheduledAt,
    params.report.scheduleTimezone,
  );
  const nextScheduledRunAt = computeNextScheduledUpdateAt(
    params.report.cronExpression,
    params.now,
    params.report.scheduleTimezone,
  );
  try {
    return await params.prisma.$transaction(async (tx) => {
      const claim = await tx.report.updateMany({
        where: {
          id: params.report.id,
          revision: params.report.revision,
          isEnabled: true,
          OR: [
            { nextScheduledRunAt: null },
            { nextScheduledRunAt: { lte: params.now } },
          ],
          AND: {
            OR: [
              { lastScheduledLocalDate: null },
              { lastScheduledLocalDate: { not: localDate } },
            ],
          },
        },
        data: {
          lastScheduledLocalDate: localDate,
          nextScheduledRunAt,
          lastScheduledRunAt: params.now,
          updatedTime: new Date(),
        },
      });
      if (claim.count === 0) {
        const duplicate = await tx.report.updateMany({
          where: {
            id: params.report.id,
            revision: params.report.revision,
            isEnabled: true,
            lastScheduledLocalDate: localDate,
            OR: [
              { nextScheduledRunAt: null },
              { nextScheduledRunAt: { lte: params.now } },
            ],
          },
          data: { nextScheduledRunAt, updatedTime: new Date() },
        });
        if (duplicate.count > 0) {
          logger.warn(
            `[ReportScheduler] Suppressed duplicate local-date run for report ${params.report.id.toString()} on ${localDate}`,
          );
        }
        return null;
      }
      const run = await tx.reportRun.create({
        data: {
          reportId: params.report.id,
          serverId: params.report.serverId,
          trigger: "SCHEDULED",
          status: "RUNNING",
          startedAt: params.now,
          querySnapshot: params.report.queryText,
          deliveryState: "PENDING",
          ...(params.workflowRunId === undefined
            ? {}
            : { temporalWorkflowRunId: params.workflowRunId }),
        },
      });
      if (params.report.sourceCompetitionId !== null) {
        await tx.competition.update({
          where: { id: params.report.sourceCompetitionId },
          data: {
            nextScheduledUpdateAt: nextScheduledRunAt,
            lastScheduledUpdateAt: params.now,
          },
        });
      }
      return {
        report: params.report,
        runId: run.id,
        status: run.status,
        isNew: true,
      };
    });
  } catch (error) {
    if (params.workflowRunId !== undefined) {
      const existing = await params.prisma.reportRun.findUnique({
        where: { temporalWorkflowRunId: params.workflowRunId },
      });
      if (existing !== null) {
        if (
          existing.reportId !== params.report.id ||
          existing.trigger !== "SCHEDULED"
        ) {
          throw new Error(
            `Temporal Workflow Run ${params.workflowRunId} raced with an incompatible report execution`,
            { cause: error },
          );
        }
        return {
          report: params.report,
          runId: existing.id,
          status: existing.status,
          isNew: false,
        };
      }
    }
    throw error;
  }
}

async function executeScheduledReportClaim(
  database: ExtendedPrismaClient,
  claim: ScheduledReportClaim,
): Promise<ReportRunResult> {
  if (claim.status === "SUCCESS") {
    throw new Error(
      `Successful report run ${claim.runId.toString()} cannot be executed again`,
    );
  }
  if (claim.status === "FAILED") {
    const reopened = await database.reportRun.updateMany({
      where: { id: claim.runId, status: "FAILED" },
      data: {
        status: "RUNNING",
        completedAt: null,
        durationMs: null,
        errorMessage: null,
        rowsReturned: 0,
        rowsScanned: 0,
        renderedContent: null,
        imageS3Key: null,
        imageByteSize: null,
        visualizationS3Key: null,
        visualizationByteSize: null,
        deliveryState: "PENDING",
        deliveryError: null,
        deliveredAt: null,
      },
    });
    if (reopened.count === 0) {
      const current = await database.reportRun.findUniqueOrThrow({
        where: { id: claim.runId },
      });
      if (current.status === "SUCCESS") {
        throw new Error(
          `Successful report run ${claim.runId.toString()} cannot be executed again`,
        );
      }
      throw new Error(
        `Report run ${claim.runId.toString()} could not be reopened from ${current.status}`,
      );
    }
  } else if (claim.status !== "RUNNING") {
    throw new Error(
      `Report run ${claim.runId.toString()} cannot execute from ${claim.status}`,
    );
  }
  return await runReport({
    prisma: database,
    report: claim.report,
    trigger: "SCHEDULED",
    now: new Date(),
    runId: claim.runId,
    deliveryRequested: true,
  });
}

function recordScheduledReportFailure(report: Report, error: unknown): void {
  if (isReportCompileFailure(report.queryText)) {
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
