import { proxyActivities } from "@temporalio/workflow";
import type {
  LinkRotScanActivities,
  LinkRotScanResult,
} from "#activities/maintenance/link-rot-scan.ts";
import type { LinkRotScanAlertActivities } from "#activities/maintenance/link-rot-scan-alerts.ts";
import type { ReportDeliveryActivities } from "#activities/reports/report-delivery.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  buildLinkRotFailureReport,
  buildLinkRotReport,
  countCriticalReportFindings,
} from "#activities/maintenance/link-rot-scan-report.ts";

const RETRY = {
  maximumAttempts: 3,
  initialInterval: "1 minute" as const,
  backoffCoefficient: 2,
  maximumInterval: "10 minutes" as const,
};

// Clone + full markdown link check (hundreds of URLs at bounded concurrency
// with retries) fits well inside 20 minutes; heartbeats fire every 15s.
//
// The scan runs on the isolated MAINTENANCE queue, not the reports queue:
// it is a long git/lychee subprocess reaching arbitrary external hosts, and the
// reports worker also serves latency-sensitive report work.
// The maintenance worker is already serial (one activity slot), runs the same
// image (so it carries the pinned lychee binary), and keeps that failure and
// memory risk out of the credentialed reports pod — the same split the Trivy
// scan uses.
const { scanMainForLinkRot } = proxyActivities<LinkRotScanActivities>({
  taskQueue: TASK_QUEUES.MAINTENANCE,
  startToCloseTimeout: "20 minutes",
  heartbeatTimeout: "90 seconds",
  retry: RETRY,
});
// Delivery and alert publication run on the reports queue, which owns the
// Postal, report-state S3, and ALERTMANAGER_URL credentials.
const deliveryActivities = proxyActivities<ReportDeliveryActivities>({
  taskQueue: TASK_QUEUES.REPORTS,
  startToCloseTimeout: "2 minutes",
  retry: RETRY,
});
const alertActivities = proxyActivities<LinkRotScanAlertActivities>({
  taskQueue: TASK_QUEUES.REPORTS,
  startToCloseTimeout: "1 minute",
  retry: RETRY,
});

/**
 * Weekly lychee link-rot scan of current `main`.
 *
 * Policy: the report email is delivered on every run. Dead links are warning
 * findings, so in practice email is the only delivery channel; the
 * Alertmanager fire/resolve publish is kept for symmetry with the
 * vulnerability scan and pages only if a critical finding ever appears.
 */
export async function runLinkRotScanWorkflow(): Promise<void> {
  const startedAt = new Date().toISOString();
  // Only a clone/scan failure produces the failure report. Wrapping the
  // delivery and alert calls too would let an Alertmanager outage — after the
  // scan completed and its results were already emailed — send a second report
  // claiming the scan failed and produced no verdict, replacing a valid result
  // with a false one. A publication failure instead fails the workflow, which
  // `temporal-failure-watch` turns into its own occurrence.
  let result: LinkRotScanResult;
  try {
    result = await scanMainForLinkRot();
  } catch (error) {
    await deliveryActivities.deliverActivityReport(
      buildLinkRotFailureReport(startedAt, error),
    );
    throw error;
  }
  const report = buildLinkRotReport(startedAt, result);
  await deliveryActivities.deliverActivityReport(report);
  await alertActivities.publishLinkRotScanAlerts({
    criticalCount: countCriticalReportFindings(report),
    repoSha: result.repoSha,
  });
}
