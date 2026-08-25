import { ApplicationFailure } from "@temporalio/common";
import type { ScoutReportActivityInput } from "@scout-for-lol/temporal/contracts";
import { ReportRunIdSchema, type ReportRunId } from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { deliverPendingReportDispatches } from "#src/reports/discord-dispatcher.ts";
import { runReport } from "#src/reports/runner.ts";
import { runScheduledReportOccurrence } from "#src/reports/scheduler.ts";
import { InvalidSavedQueryError } from "#src/reports/query-engine.ts";

type ScoutReportRecord = Awaited<
  ReturnType<ExtendedPrismaClient["report"]["findUnique"]>
>;

function parseManualRunId(
  input: ScoutReportActivityInput,
): ReportRunId | undefined {
  if (input.source === "schedule") return undefined;
  const result = ReportRunIdSchema.safeParse(Number(input.runId));
  if (!result.success) {
    throw ApplicationFailure.nonRetryable(
      "Manual report execution requires a valid run ID",
      "InvalidReportRunId",
    );
  }
  return result.data;
}

async function resumeCompletedManualDelivery(
  input: ScoutReportActivityInput,
  report: ScoutReportRecord,
  manualRunId: ReportRunId | undefined,
  database: ExtendedPrismaClient,
): Promise<boolean> {
  if (manualRunId === undefined || report === null) return false;
  const existingRun = await database.reportRun.findUnique({
    where: { id: manualRunId },
    select: { status: true },
  });
  if (existingRun?.status !== "SUCCESS") return false;
  if (input.post) {
    await deliverPendingReportDispatches(
      {
        reportId: Number(input.reportId),
        trigger: "MANUAL",
        runId: manualRunId,
      },
      database,
    );
  }
  return true;
}

function reportExecutionIsStale(
  report: ScoutReportRecord,
  input: ScoutReportActivityInput,
): boolean {
  if (report === null) return true;
  return (
    report.revision !== input.revision ||
    (input.source === "schedule" && !report.isEnabled)
  );
}

async function markStaleReportExecution(
  input: ScoutReportActivityInput,
  manualRunId: ReportRunId | undefined,
  database: ExtendedPrismaClient,
): Promise<void> {
  if (manualRunId !== undefined) {
    await database.reportRun.updateMany({
      where: { id: manualRunId, status: "RUNNING" },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage:
          "Report definition changed, was disabled, or was deleted before execution.",
      },
    });
  }
  if (input.source === "schedule") {
    await database.reportRun.updateMany({
      where: {
        temporalWorkflowRunId: input.workflowRunId,
        status: "RUNNING",
      },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage:
          "Scheduled report definition changed, was disabled, or was deleted before execution could resume.",
      },
    });
  }
}

export async function runScoutReportActivity(
  input: ScoutReportActivityInput,
  database: ExtendedPrismaClient = prisma,
): Promise<void> {
  const reportId = Number(input.reportId);
  if (!Number.isSafeInteger(reportId) || reportId <= 0) {
    throw ApplicationFailure.nonRetryable(
      `Invalid report ID ${input.reportId}`,
      "InvalidReportId",
    );
  }
  const manualRunId = parseManualRunId(input);
  const report = await database.report.findUnique({
    where: { id: reportId },
  });
  // A completed manual run can still have a pending Discord delivery after an
  // activity retry. A subsequent report edit changes the revision, but must
  // not make that durable delivery unreachable; the persisted run already
  // contains the validated output to deliver.
  if (
    await resumeCompletedManualDelivery(input, report, manualRunId, database)
  ) {
    return;
  }
  if (reportExecutionIsStale(report, input)) {
    await markStaleReportExecution(input, manualRunId, database);
    return;
  }
  if (report === null) {
    throw new Error("Report disappeared after the execution staleness check");
  }
  if (input.source === "schedule") {
    let runId: number | null;
    try {
      runId = await runScheduledReportOccurrence({
        prisma: database,
        report,
        workflowRunId: input.workflowRunId,
      });
    } catch (error: unknown) {
      if (error instanceof InvalidSavedQueryError) {
        throw ApplicationFailure.nonRetryable(
          error.message,
          "InvalidSavedQuery",
        );
      }
      throw error;
    }
    if (runId === null) return;
    await deliverPendingReportDispatches(
      { reportId, trigger: "SCHEDULED", runId },
      database,
    );
    await deliverPendingReportDispatches(
      { reportId, trigger: "SCHEDULED", failureMode: "isolate" },
      database,
    );
    return;
  }
  if (manualRunId === undefined) {
    throw new Error("Missing manual run ID");
  }
  const runId = manualRunId;
  const existingRun = await database.reportRun.findUniqueOrThrow({
    where: { id: runId },
    select: { status: true },
  });
  if (existingRun.status === "FAILED") {
    const reopened = await database.reportRun.updateMany({
      where: { id: runId, status: "FAILED" },
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
        deliveryState: input.post ? "PENDING" : "NOT_REQUESTED",
        deliveryError: null,
        deliveredAt: null,
      },
    });
    if (reopened.count === 0) {
      throw new Error(
        `Manual report run ${runId.toString()} changed while preparing its retry`,
      );
    }
  } else if (existingRun.status !== "RUNNING") {
    throw ApplicationFailure.nonRetryable(
      `Manual report run ${runId.toString()} is already ${existingRun.status}`,
      "InvalidReportRunState",
    );
  }
  try {
    await runReport({
      prisma: database,
      report,
      trigger: "MANUAL",
      runId,
      deliveryRequested: input.post,
    });
  } catch (error: unknown) {
    if (error instanceof InvalidSavedQueryError) {
      throw ApplicationFailure.nonRetryable(error.message, "InvalidSavedQuery");
    }
    throw error;
  }
  if (input.post) {
    await deliverPendingReportDispatches(
      { reportId, trigger: "MANUAL", runId },
      database,
    );
  }
}
