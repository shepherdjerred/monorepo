import { proxyActivities } from "@temporalio/workflow";
import type { LinkRotScanActivities } from "#activities/link-rot-scan.ts";
import type { LinkRotScanAlertActivities } from "#activities/link-rot-scan-alerts.ts";
import type { ReportDeliveryActivities } from "#activities/report-delivery.ts";
import {
  buildLinkRotFailureReport,
  buildLinkRotReport,
  countCriticalReportFindings,
} from "#activities/link-rot-scan-report.ts";

const RETRY = {
  maximumAttempts: 3,
  initialInterval: "1 minute" as const,
  backoffCoefficient: 2,
  maximumInterval: "10 minutes" as const,
};

// Clone + full markdown link check (hundreds of URLs at bounded concurrency
// with retries) fits well inside 20 minutes; heartbeats fire every 15s.
// Everything runs on TASK_QUEUES.DEFAULT — the schedule targets that queue,
// and unlike the Trivy scan there is no warm cache confining this to the
// maintenance pod.
const { scanMainForLinkRot } = proxyActivities<LinkRotScanActivities>({
  startToCloseTimeout: "20 minutes",
  heartbeatTimeout: "90 seconds",
  retry: RETRY,
});
const { deliverActivityReport } = proxyActivities<ReportDeliveryActivities>({
  startToCloseTimeout: "2 minutes",
  retry: RETRY,
});
const { publishLinkRotScanAlerts } =
  proxyActivities<LinkRotScanAlertActivities>({
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
  try {
    const result = await scanMainForLinkRot();
    const report = buildLinkRotReport(startedAt, result);
    await deliverActivityReport(report);
    await publishLinkRotScanAlerts({
      criticalCount: countCriticalReportFindings(report),
      repoSha: result.repoSha,
    });
  } catch (error) {
    await deliverActivityReport(buildLinkRotFailureReport(startedAt, error));
    throw error;
  }
}
