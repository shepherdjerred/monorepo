// Pure report assembly for the weekly main vulnerability scan — no I/O, no
// Sentry/observability imports, so the workflow bundle can import it directly
// (same pattern as homelab-audit-report.ts).
import type { MainVulnScanResult } from "./main-vuln-scan.ts";
import type { ActivityReportInput } from "#activities/reports/report-delivery.ts";

export const MAIN_VULN_SCAN_REPORT_TYPE = "main-vuln-scan";
export const MAIN_VULN_SCAN_SCHEDULE_ID = "main-vuln-scan-weekly";
export const MAIN_VULN_SCAN_TITLE = "Weekly Trivy vulnerability scan of main";

const SCAN_RECEIPT_ID = "trivy-scan";

function findingSummary(
  vulnerability: MainVulnScanResult["vulnerabilities"][number],
): string {
  return `${vulnerability.vulnerabilityId}: ${vulnerability.pkgName}@${vulnerability.installedVersion} (${vulnerability.severity})`;
}

function findingDetail(
  vulnerability: MainVulnScanResult["vulnerabilities"][number],
): string {
  return [
    vulnerability.title,
    `Target: ${vulnerability.target}`,
    vulnerability.fixedVersion === undefined
      ? "No fixed version published yet"
      : `Fixed in: ${vulnerability.fixedVersion}`,
    vulnerability.primaryUrl,
  ]
    .filter((part) => part !== undefined)
    .join(" — ");
}

export function countCriticalVulnerabilities(
  result: Pick<MainVulnScanResult, "vulnerabilities">,
): number {
  return result.vulnerabilities.filter(
    (vulnerability) => vulnerability.severity === "CRITICAL",
  ).length;
}

/** Trivy severity → report severity. HIGH warns, CRITICAL pages. */
function reportSeverity(severity: "HIGH" | "CRITICAL"): "warning" | "critical" {
  return severity === "CRITICAL" ? "critical" : "warning";
}

export function buildMainVulnScanReport(
  startedAt: string,
  result: MainVulnScanResult,
): ActivityReportInput {
  const total = result.vulnerabilities.length;
  const critical = countCriticalVulnerabilities(result);
  const high = total - critical;
  const clean = total === 0;
  return {
    reportType: MAIN_VULN_SCAN_REPORT_TYPE,
    title: MAIN_VULN_SCAN_TITLE,
    scheduleId: MAIN_VULN_SCAN_SCHEDULE_ID,
    startedAt,
    execution: "complete",
    verdict: clean ? "clear" : "attention",
    headline: clean
      ? `Trivy found no HIGH/CRITICAL vulnerabilities on main@${result.repoSha.slice(0, 12)}.`
      : `Trivy found ${String(critical)} CRITICAL and ${String(high)} HIGH vulnerabilities on main@${result.repoSha.slice(0, 12)}.`,
    checks: [
      {
        id: "trivy-scan-completed",
        label: "Trivy filesystem scan of main completed",
        required: true,
        status: "passed",
        summary: `Scanned main@${result.repoSha.slice(0, 12)} with the warm Buildkite Trivy DB; ${String(total)} HIGH/CRITICAL findings.`,
        evidenceReceiptIds: [SCAN_RECEIPT_ID],
      },
    ],
    evidence: [
      {
        id: SCAN_RECEIPT_ID,
        source: "trivy fs (shallow clone of main)",
        observedAt: result.observedAt,
        status: "success",
        command: result.command,
        exitCode: result.exitCode,
        excerpt: result.excerpt,
      },
    ],
    findings: result.vulnerabilities.map((vulnerability) => ({
      section:
        vulnerability.severity === "CRITICAL"
          ? "Critical vulnerabilities"
          : "High vulnerabilities",
      severity: reportSeverity(vulnerability.severity),
      summary: findingSummary(vulnerability),
      detail: findingDetail(vulnerability),
      evidenceReceiptIds: [SCAN_RECEIPT_ID],
    })),
    limitations: [
      "Scan covers HIGH/CRITICAL vulnerability findings only (scanners=vuln; node_modules and sandbox skipped; .trivyignore applies).",
    ],
    actions: clean
      ? []
      : [
          "Upgrade the affected packages, or record a justified ignore in .trivyignore.",
        ],
    provenance: {
      source: "https://github.com/shepherdjerred/monorepo",
      repoSha: result.repoSha,
    },
  };
}

export function buildMainVulnScanFailureReport(
  startedAt: string,
  error: unknown,
): ActivityReportInput {
  const message = error instanceof Error ? error.message : String(error);
  const observedAt = new Date().toISOString();
  return {
    reportType: MAIN_VULN_SCAN_REPORT_TYPE,
    title: MAIN_VULN_SCAN_TITLE,
    scheduleId: MAIN_VULN_SCAN_SCHEDULE_ID,
    startedAt,
    execution: "failed",
    verdict: "inconclusive",
    headline: "The Trivy scan of main failed; no vulnerability verdict.",
    checks: [
      {
        id: "trivy-scan-completed",
        label: "Trivy filesystem scan of main completed",
        required: true,
        status: "failed",
        summary: message,
        evidenceReceiptIds: ["scan-failure"],
      },
    ],
    evidence: [
      {
        id: "scan-failure",
        source: "main vulnerability scan workflow",
        observedAt,
        status: "failure",
        excerpt: message.slice(0, 2000),
      },
    ],
    findings: [],
    limitations: [
      "The clone or Trivy scan did not produce a parseable report.",
    ],
    actions: ["Inspect the failed activity and rerun the schedule."],
    provenance: { source: "https://github.com/shepherdjerred/monorepo" },
  };
}
