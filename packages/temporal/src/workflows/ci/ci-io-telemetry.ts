import { proxyActivities } from "@temporalio/workflow";
import type {
  CiIoObservabilityActivities,
  CiIoObservabilityResult,
} from "#activities/maintenance/ci-io-observability.ts";
import type {
  ActivityReportInput,
  ReportDeliveryActivities,
} from "#activities/reports/report-delivery.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { reportActivityTaskQueue } from "#workflows/scout/report-activity-queue.ts";

/**
 * Daily health check on the CI I/O telemetry pipeline itself.
 *
 * Successor to the post-merge impact report, which measured one specific PR
 * against a frozen July-2026 Buildkite cohort. That comparison cannot be
 * reproduced: its baseline lives in `buildkite:` recording rules that the
 * migration stopped producing, so the report could only ever have returned
 * "could not finish". Its own retirement criteria — seven days and 100 builds
 * observed — had long since been met.
 *
 * What is worth keeping is the part that watched the measurement chain rather
 * than the measurement: that the recording rules evaluate, stay fresh, stay
 * within their series budget, and that the dashboard reading them still has
 * its panels. That chain is exactly what silently broke when the pod metadata
 * scheme changed, which is the argument for checking it daily.
 */
const { collectCiIoObservability } =
  proxyActivities<CiIoObservabilityActivities>({
    taskQueue: TASK_QUEUES.INFRA,
    startToCloseTimeout: "10 minutes",
    retry: { maximumAttempts: 2 },
  });

const REPORT_TYPE = "ci-io-telemetry";
const SCHEDULE_ID = "ci-io-telemetry-daily";
const TITLE = "CI I/O telemetry health";

function checkFor(
  result: CiIoObservabilityResult,
): ActivityReportInput["checks"][number] {
  return {
    id: result.id,
    label: result.id,
    required: true,
    status: result.passed ? "passed" : "failed",
    summary: `${result.series.toString()} series; values ${JSON.stringify(result.values)}`,
    evidenceReceiptIds: [result.id],
  };
}

function evidenceFor(
  result: CiIoObservabilityResult,
  observedAt: string,
): ActivityReportInput["evidence"][number] {
  return {
    id: result.id,
    source: "Prometheus instant query API",
    observedAt,
    // Evidence status is whether the observation was made, not whether it was
    // the value we wanted: a query that answered is successful evidence even
    // when its answer fails a threshold. A query that could not answer throws,
    // and the run becomes a failure report instead.
    status: "success",
    excerpt: JSON.stringify({
      query: result.query,
      series: result.series,
      values: result.values,
      minimumRequiredSeries: result.minimumRequiredSeries,
      minimumValue: result.minimumValue,
      maximumValue: result.maximumValue,
    }).slice(0, 2000),
  };
}

export function ciIoTelemetryReport(
  startedAt: string,
  observedAt: string,
  results: readonly CiIoObservabilityResult[],
): ActivityReportInput {
  const failed = results.filter((result) => !result.passed);
  return {
    reportType: REPORT_TYPE,
    title: TITLE,
    scheduleId: SCHEDULE_ID,
    startedAt,
    execution: "complete",
    verdict: failed.length === 0 ? "clear" : "attention",
    headline:
      failed.length === 0
        ? `All ${results.length.toString()} CI I/O telemetry checks passed.`
        : `${failed.length.toString()} of ${results.length.toString()} CI I/O telemetry checks failed.`,
    checks: results.map((result) => checkFor(result)),
    evidence: results.map((result) => evidenceFor(result, observedAt)),
    findings: failed.map((result) => ({
      severity: "warning" as const,
      summary: `CI I/O telemetry check ${result.id} failed`,
      detail: `Query returned ${result.series.toString()} series with values ${JSON.stringify(result.values)}.`,
      evidenceReceiptIds: [result.id],
    })),
    limitations:
      failed.length === 0
        ? []
        : [
            "A failing check means the measurement chain is broken, not that CI wrote more or less.",
          ],
    actions:
      failed.length === 0
        ? []
        : [
            "Check the recording rules, the kube-state-metrics label allowlist, and the labels the configuration extension stamps — all three must agree or the joins return nothing.",
          ],
    provenance: {
      source: "Prometheus and Grafana",
      windowEnd: observedAt,
      query: "CI I/O recording-rule health, freshness, budget, and panels",
    },
  };
}

function failureReport(startedAt: string, error: unknown): ActivityReportInput {
  const message = error instanceof Error ? error.message : String(error);
  const observedAt = new Date().toISOString();
  return {
    reportType: REPORT_TYPE,
    title: TITLE,
    scheduleId: SCHEDULE_ID,
    startedAt,
    execution: "failed",
    verdict: "inconclusive",
    headline: "CI I/O telemetry collection failed.",
    checks: [
      {
        id: "ci-io-telemetry-run",
        label: "CI I/O telemetry collection",
        required: true,
        status: "failed",
        summary: message,
        evidenceReceiptIds: ["ci-io-telemetry-failure"],
      },
    ],
    evidence: [
      {
        id: "ci-io-telemetry-failure",
        source: "CI I/O telemetry workflow",
        observedAt,
        status: "failure",
        excerpt: message.slice(0, 2000),
      },
    ],
    findings: [],
    limitations: ["Telemetry evidence could not be collected."],
    actions: ["Inspect the failed activity and rerun the schedule."],
    provenance: { source: "CI I/O telemetry workflow" },
  };
}

export async function runCiIoTelemetry(): Promise<void> {
  const { deliverActivityReport } = proxyActivities<ReportDeliveryActivities>({
    taskQueue: reportActivityTaskQueue(),
    startToCloseTimeout: "2 minutes",
    retry: { maximumAttempts: 3 },
  });
  const startedAt = new Date().toISOString();
  try {
    const results = await collectCiIoObservability();
    await deliverActivityReport(
      ciIoTelemetryReport(startedAt, new Date().toISOString(), results),
    );
  } catch (error) {
    await deliverActivityReport(failureReport(startedAt, error));
    throw error;
  }
}
