// Pure report assembly for the weekly main vulnerability scan — no I/O, no
// Bugsink/observability imports, so the workflow bundle can import it directly
// (same pattern as homelab-audit-report.ts).
import type { ReportRemediationV1 } from "@shepherdjerred/ops-model/reports/report-envelope.ts";
import type { MainVulnScanResult } from "./main-vuln-scan.ts";
import type { ActivityReportInput } from "#activities/reports/report-delivery.ts";
import { buildScannerRemediationArtifacts } from "#activities/remediation/scanner-remediation-report.ts";

export const MAIN_VULN_SCAN_REPORT_TYPE = "main-vuln-scan";
export const MAIN_VULN_SCAN_SCHEDULE_ID = "main-vuln-scan-weekly";
export const MAIN_VULN_SCAN_TITLE = "Weekly Trivy vulnerability scan of main";

const SCAN_RECEIPT_ID = "trivy-scan";
const REMEDIATION_RECEIPT_ID = "vuln-remediation";

type Vulnerability = MainVulnScanResult["vulnerabilities"][number];
export type GroupedVulnerability = Vulnerability & { targets: string[] };

/** Repeated lockfiles are affected targets, not additional advisories. */
export function groupVulnerabilities(
  vulnerabilities: readonly Vulnerability[],
): GroupedVulnerability[] {
  const groups = new Map<string, GroupedVulnerability>();
  for (const vulnerability of vulnerabilities) {
    const key = JSON.stringify([
      vulnerability.vulnerabilityId,
      vulnerability.pkgName,
      vulnerability.installedVersion,
      vulnerability.severity,
      vulnerability.fixedVersion,
    ]);
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, { ...vulnerability, targets: [vulnerability.target] });
    } else if (!existing.targets.includes(vulnerability.target)) {
      existing.targets.push(vulnerability.target);
    }
  }
  return [...groups.values()].map((group) => ({
    ...group,
    targets: group.targets.sort((left, right) => left.localeCompare(right)),
  }));
}

function findingSummary(
  vulnerability: MainVulnScanResult["vulnerabilities"][number],
): string {
  return `${vulnerability.vulnerabilityId}: ${vulnerability.pkgName}@${vulnerability.installedVersion} (${vulnerability.severity})`;
}

function findingDetail(vulnerability: GroupedVulnerability): string {
  return [
    vulnerability.title,
    `Targets (${String(vulnerability.targets.length)}): ${vulnerability.targets.join(", ")}`,
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
  return groupVulnerabilities(result.vulnerabilities).filter(
    (vulnerability) => vulnerability.severity === "CRITICAL",
  ).length;
}

/** Trivy severity → report severity. HIGH warns, CRITICAL pages. */
function reportSeverity(severity: "HIGH" | "CRITICAL"): "warning" | "critical" {
  return severity === "CRITICAL" ? "critical" : "warning";
}

function buildVulnRemediationCheckAndEvidence(
  observedAt: string,
  remediation: ReportRemediationV1 | undefined,
): {
  checks: ActivityReportInput["checks"];
  evidence: ActivityReportInput["evidence"];
} {
  return buildScannerRemediationArtifacts({
    observedAt,
    remediation,
    checkId: "vuln-remediation",
    checkLabel: "Automated vulnerability remediation",
    receiptId: REMEDIATION_RECEIPT_ID,
    receiptSource: "Codex SDK vulnerability remediation",
  });
}

export function buildMainVulnScanReport(
  startedAt: string,
  result: MainVulnScanResult,
  remediation?: ReportRemediationV1,
): ActivityReportInput {
  const groups = groupVulnerabilities(result.vulnerabilities);
  const total = groups.length;
  const affectedRows = result.vulnerabilities.length;
  const critical = countCriticalVulnerabilities(result);
  const high = total - critical;
  const clean = total === 0;
  const allHighAddressedInPr =
    !clean &&
    critical === 0 &&
    remediation?.prUrl !== undefined &&
    (remediation.unresolvedCount ?? 0) === 0;
  const verdict = clean
    ? "clear"
    : allHighAddressedInPr
      ? "changed"
      : "attention";
  const remediationArtifacts = buildVulnRemediationCheckAndEvidence(
    result.observedAt,
    remediation,
  );
  const prHeadlineSuffix =
    remediation?.prUrl === undefined
      ? ""
      : ` Remediation PR opened for review (${remediation.prUrl}).`;

  return {
    reportType: MAIN_VULN_SCAN_REPORT_TYPE,
    title: MAIN_VULN_SCAN_TITLE,
    scheduleId: MAIN_VULN_SCAN_SCHEDULE_ID,
    startedAt,
    execution: "complete",
    verdict,
    headline: clean
      ? `Trivy found no HIGH/CRITICAL vulnerabilities on main@${result.repoSha.slice(0, 12)}.`
      : `Trivy found ${String(critical)} CRITICAL and ${String(high)} HIGH advisory/package/version combinations across ${String(affectedRows)} affected package/target rows on main@${result.repoSha.slice(0, 12)}.${prHeadlineSuffix}`,
    checks: [
      {
        id: "trivy-scan-completed",
        label: "Trivy filesystem scan of main completed",
        required: true,
        status: "passed",
        summary: `Scanned main@${result.repoSha.slice(0, 12)} with the warm Woodpecker Trivy DB; ${String(total)} HIGH/CRITICAL advisory/package/version combinations across ${String(affectedRows)} affected package/target rows.`,
        evidenceReceiptIds: [SCAN_RECEIPT_ID],
      },
      ...remediationArtifacts.checks,
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
      ...remediationArtifacts.evidence,
    ],
    findings: groups.map((vulnerability) => ({
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
      ...(remediation?.outcome === "partial" &&
      remediation.summary !== undefined
        ? [remediation.summary]
        : []),
    ],
    actions: clean
      ? []
      : remediation?.prUrl === undefined
        ? [
            "Upgrade available fixes and assess advisories without published fixes; retain upstream follow-up for unresolved findings.",
          ]
        : [
            `Review and merge vulnerability remediation PR ${remediation.prUrl}; assess any remaining advisories without published fixes.`,
          ],
    ...(remediation === undefined ? {} : { remediation }),
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
