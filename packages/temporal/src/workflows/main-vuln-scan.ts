import { proxyActivities } from "@temporalio/workflow";
import type {
  MainVulnScanActivities,
  MainVulnScanResult,
} from "#activities/main-vuln-scan.ts";
import type { MainVulnScanAlertActivities } from "#activities/main-vuln-scan-alerts.ts";
import type { ReportDeliveryActivities } from "#activities/report-delivery.ts";
import {
  buildMainVulnScanFailureReport,
  buildMainVulnScanReport,
  countCriticalVulnerabilities,
} from "#activities/main-vuln-scan-report.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const RETRY = {
  maximumAttempts: 3,
  initialInterval: "1 minute" as const,
  backoffCoefficient: 2,
  maximumInterval: "10 minutes" as const,
};

// The scan runs on the workflow's own (maintenance) queue: that worker mounts
// the warm Trivy DB PVC. Clone + scan of the repo fits well inside 20 minutes;
// heartbeats fire every 15s, so worker death surfaces quickly.
const { scanMainForVulnerabilities } = proxyActivities<MainVulnScanActivities>({
  startToCloseTimeout: "20 minutes",
  heartbeatTimeout: "90 seconds",
  retry: RETRY,
});

// Delivery and alert publication run on the core worker: Postal, report-state
// S3, and ALERTMANAGER_URL deliberately never reach the maintenance pod.
const { deliverActivityReport } = proxyActivities<ReportDeliveryActivities>({
  taskQueue: TASK_QUEUES.DEFAULT,
  startToCloseTimeout: "2 minutes",
  retry: RETRY,
});
const { publishMainVulnScanAlerts } =
  proxyActivities<MainVulnScanAlertActivities>({
    taskQueue: TASK_QUEUES.DEFAULT,
    startToCloseTimeout: "1 minute",
    retry: RETRY,
  });

/**
 * Weekly Trivy HIGH/CRITICAL scan of current `main`.
 *
 * Policy: the report email is delivered on every run; Alertmanager receives
 * exactly one fire/resolve occurrence per run — firing only while at least one
 * CRITICAL finding exists, resolving as soon as a run comes back clean.
 */
export async function runMainVulnScanWorkflow(): Promise<void> {
  const startedAt = new Date().toISOString();
  // Only a clone/scan failure produces the failure report. Wrapping the
  // delivery and alert calls too would let an Alertmanager outage — after the
  // scan completed and its results were already emailed — send a second
  // report claiming the scan failed, publishing contradictory receipts for one
  // run. A publication failure instead fails the workflow, which
  // `temporal-failure-watch` turns into its own occurrence.
  let result: MainVulnScanResult;
  try {
    result = await scanMainForVulnerabilities();
  } catch (error) {
    await deliverActivityReport(
      buildMainVulnScanFailureReport(startedAt, error),
    );
    throw error;
  }
  await deliverActivityReport(buildMainVulnScanReport(startedAt, result));
  await publishMainVulnScanAlerts({
    criticalCount: countCriticalVulnerabilities(result),
    repoSha: result.repoSha,
  });
}
