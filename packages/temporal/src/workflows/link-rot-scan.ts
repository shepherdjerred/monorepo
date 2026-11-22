import {
  REPORT_DELIVERY_ACTIVITY_RETRY,
  REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS,
} from "#shared/reports/report-delivery-policy.ts";
import { patched, proxyActivities } from "@temporalio/workflow";
import type {
  LinkRotScanActivities,
  LinkRotScanResult,
} from "#activities/maintenance/link-rot/link-rot-scan.ts";
import type { LinkRotRemediationActivities } from "#activities/maintenance/link-rot/link-rot-remediation.ts";
import type { LinkRotScanAlertActivities } from "#activities/maintenance/link-rot/link-rot-scan-alerts.ts";
import type { ReportDeliveryActivities } from "#activities/reports/report-delivery.ts";
import type { ReportRemediationV1 } from "#shared/reports/report.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  buildLinkRotFailureReport,
  buildLinkRotReport,
  countCriticalReportFindings,
} from "#activities/maintenance/link-rot/link-rot-scan-report.ts";

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
// Codex SDK + GitHub App PR creation runs on REPO_AUTOMATION, which holds
// OPENAI_API_KEY and the GitHub App installation credentials.
const { remediateLinkRot } = proxyActivities<LinkRotRemediationActivities>({
  taskQueue: TASK_QUEUES.REPO_AUTOMATION,
  startToCloseTimeout: "35 minutes",
  heartbeatTimeout: "90 seconds",
  retry: {
    maximumAttempts: 2,
    initialInterval: "1 minute",
    backoffCoefficient: 2,
    maximumInterval: "5 minutes",
  },
});
// Delivery and alert publication run on the reports queue, which owns the
// Postal, report-state S3, and ALERTMANAGER_URL credentials.
const deliveryActivities = proxyActivities<ReportDeliveryActivities>({
  taskQueue: TASK_QUEUES.REPORTS,
  startToCloseTimeout: REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS,
  retry: REPORT_DELIVERY_ACTIVITY_RETRY,
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

  let remediation: ReportRemediationV1 | undefined;
  if (result.deadLinks.length > 0 && patched("link-rot-remediation-v1")) {
    try {
      remediation = await remediateLinkRot(result);
    } catch (error) {
      const cause =
        error instanceof Error && error.cause instanceof Error
          ? error.cause.message
          : error instanceof Error
            ? error.message
            : String(error);
      remediation = {
        outcome: "partial",
        changedFiles: [],
        resolvedCount: 0,
        unresolvedCount: result.deadLinks.length,
        summary: `Automated dead-link remediation failed: ${cause}`.slice(
          0,
          500,
        ),
      };
    }
  }

  const report = buildLinkRotReport(startedAt, result, remediation);
  await deliveryActivities.deliverActivityReport(report);
  await alertActivities.publishLinkRotScanAlerts({
    criticalCount: countCriticalReportFindings(report),
    repoSha: result.repoSha,
  });
}
