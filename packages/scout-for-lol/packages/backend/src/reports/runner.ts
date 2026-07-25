import {
  parseAndCompile,
  ReportRunTriggerSchema,
  type Report,
  type ReportOutputFormat,
  type ReportRunTrigger,
} from "@scout-for-lol/data";

// The `output_format` metric label is the parsed RENDER kind, or `UNKNOWN` when
// the stored query failed to parse before the kind could be derived.
type ReportMetricLabel = ReportOutputFormat | "UNKNOWN";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  scheduledReportRowsTotal,
  scheduledReportRunDurationSeconds,
  scheduledReportsDurationMs,
  scheduledReportsFailedTotal,
  scheduledReportsRowsReturnedTotal,
  scheduledReportsRowsScannedTotal,
  scheduledReportsRunTotal,
  scheduledReportRunsTotal,
  scheduledReportRowsReturnedTotal,
  scheduledReportRowsScannedTotal,
  scoutScheduledReportLastSuccessTimestamp,
} from "#src/metrics/report-runs.ts";
import { executeReportQuery } from "#src/reports/query-engine.ts";
import {
  renderReportOutput,
  type RenderedReportOutput,
} from "#src/reports/output.ts";
import { saveReportRunImage } from "#src/storage/s3-report-run.ts";

export type ReportRunResult = {
  output: RenderedReportOutput;
  rowsReturned: number;
  rowsScanned: number;
};

type RunReportParams = {
  prisma: ExtendedPrismaClient;
  report: Report;
  trigger: ReportRunTrigger;
  now?: Date;
};

export async function runReport(
  params: RunReportParams,
): Promise<ReportRunResult> {
  const trigger = ReportRunTriggerSchema.parse(params.trigger);
  const startedAt = params.now ?? new Date();
  // Record the run row up front so any failure — including a malformed stored
  // query whose RENDER clause won't parse — is captured as a FAILED run rather
  // than thrown before the run is ever recorded. The `output_format` metric
  // label is only known once the query parses; until then it stays UNKNOWN.
  const run = await params.prisma.reportRun.create({
    data: {
      reportId: params.report.id,
      serverId: params.report.serverId,
      trigger,
      status: "RUNNING",
      startedAt,
    },
  });
  let renderKind: ReportMetricLabel = "UNKNOWN";

  try {
    // The render kind lives in the query's RENDER clause; deriving it here (a)
    // surfaces a malformed stored query through the error-handled path and (b)
    // yields the `output_format` metric label.
    renderKind = parseAndCompile(params.report.queryText).render.kind;
    const result = await executeReportQuery({
      prisma: params.prisma,
      serverId: params.report.serverId,
      queryText: params.report.queryText,
      sourceCompetitionId: params.report.sourceCompetitionId,
      now: startedAt,
    });
    const output = await renderReportOutput({
      title: params.report.title,
      result,
      startedAt,
    });
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    // Archive the rendered output so the web "view posted reports" history is
    // faithful. The PNG (chart formats only) goes to S3; the text body and the
    // S3 key are persisted on the run row. Both are best-effort — a missing
    // image never fails the run.
    const imageS3Key =
      output.image === null
        ? null
        : await saveReportRunImage(params.report.id, run.id, output.image.data);

    await params.prisma.reportRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        completedAt,
        durationMs,
        rowsReturned: result.rows.length,
        rowsScanned: result.rowsScanned,
        renderedContent: output.content,
        imageS3Key,
        imageByteSize: output.image?.data.length ?? null,
      },
    });
    await params.prisma.report.update({
      where: { id: params.report.id },
      data: {
        lastRunStatus: "SUCCESS",
        lastRunError: null,
        ...(trigger === "SCHEDULED" ? { lastScheduledRunAt: startedAt } : {}),
        updatedTime: completedAt,
      },
    });
    recordReportMetrics({
      report: params.report,
      outputFormat: renderKind,
      trigger,
      status: "SUCCESS",
      durationMs,
      rowsReturned: result.rows.length,
      rowsScanned: result.rowsScanned,
      startedAt,
    });

    return {
      output,
      rowsReturned: result.rows.length,
      rowsScanned: result.rowsScanned,
    };
  } catch (error) {
    const completedAt = new Date();
    const errorMessage = error instanceof Error ? error.message : String(error);
    await params.prisma.reportRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        errorMessage,
      },
    });
    await params.prisma.report.update({
      where: { id: params.report.id },
      data: {
        lastRunStatus: "FAILED",
        lastRunError: errorMessage,
        ...(trigger === "SCHEDULED" ? { lastScheduledRunAt: startedAt } : {}),
        updatedTime: completedAt,
      },
    });
    recordReportMetrics({
      report: params.report,
      outputFormat: renderKind,
      trigger,
      status: "FAILED",
      durationMs: completedAt.getTime() - startedAt.getTime(),
      rowsReturned: 0,
      rowsScanned: 0,
      startedAt,
    });
    throw error;
  }
}

function recordReportMetrics(params: {
  report: Report;
  outputFormat: ReportMetricLabel;
  trigger: ReportRunTrigger;
  status: "SUCCESS" | "FAILED";
  durationMs: number;
  rowsReturned: number;
  rowsScanned: number;
  startedAt: Date;
}): void {
  const labels = {
    status: params.status,
    trigger: params.trigger,
    output_format: params.outputFormat,
    system_source: params.report.systemSource ?? "USER",
  };
  scheduledReportRunsTotal.inc(labels);
  scheduledReportsRunTotal.inc(labels);
  scheduledReportRunDurationSeconds.observe(labels, params.durationMs / 1000);
  scheduledReportsDurationMs.observe(labels, params.durationMs);
  if (params.status === "FAILED") {
    scheduledReportsFailedTotal.inc({
      trigger: params.trigger,
      output_format: params.outputFormat,
      system_source: params.report.systemSource ?? "USER",
    });
  }
  // Drive the staleness alert: only SCHEDULED-trigger SUCCESS counts. A
  // user's MANUAL /run must NOT silence the alert, because the bug we
  // care about is "the dispatcher never fires the schedule" — a manual
  // run wouldn't clear that.
  if (params.status === "SUCCESS" && params.trigger === "SCHEDULED") {
    scoutScheduledReportLastSuccessTimestamp.set(
      {
        report_id: params.report.id.toString(),
        system_source: params.report.systemSource ?? "USER",
        title: params.report.title,
      },
      params.startedAt.getTime() / 1000,
    );
  }
  scheduledReportRowsReturnedTotal.inc(
    {
      trigger: params.trigger,
      output_format: params.outputFormat,
      system_source: params.report.systemSource ?? "USER",
    },
    params.rowsReturned,
  );
  scheduledReportsRowsReturnedTotal.inc(
    {
      trigger: params.trigger,
      output_format: params.outputFormat,
      system_source: params.report.systemSource ?? "USER",
    },
    params.rowsReturned,
  );
  scheduledReportRowsTotal.inc(
    {
      trigger: params.trigger,
      output_format: params.outputFormat,
      system_source: params.report.systemSource ?? "USER",
    },
    params.rowsReturned,
  );
  scheduledReportRowsScannedTotal.inc(
    {
      trigger: params.trigger,
      output_format: params.outputFormat,
      system_source: params.report.systemSource ?? "USER",
    },
    params.rowsScanned,
  );
  scheduledReportsRowsScannedTotal.inc(
    {
      trigger: params.trigger,
      output_format: params.outputFormat,
      system_source: params.report.systemSource ?? "USER",
    },
    params.rowsScanned,
  );
}
