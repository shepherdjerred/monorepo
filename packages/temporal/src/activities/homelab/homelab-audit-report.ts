import type { HomelabAuditCollection } from "./homelab-audit-collectors.ts";
import type { ActivityReportInput } from "#activities/reports/report-delivery.ts";

export function buildHomelabAuditReport(
  collection: HomelabAuditCollection,
  synthesis: string | undefined,
): ActivityReportInput {
  const complete = collection.checks
    .filter((check) => check.required)
    .every((check) => check.status === "passed");
  const critical = collection.findings.filter(
    (finding) => finding.severity === "critical",
  ).length;
  const warnings = collection.findings.filter(
    (finding) => finding.severity === "warning",
  ).length;
  return {
    reportType: "homelab-audit",
    title: "Daily homelab audit",
    scheduleId: "homelab-audit-daily",
    startedAt: collection.startedAt,
    execution: complete ? "complete" : "partial",
    verdict:
      collection.findings.length === 0
        ? complete
          ? "clear"
          : "inconclusive"
        : "attention",
    headline: complete
      ? `${critical.toString()} critical and ${warnings.toString()} warning findings across six completed checks.`
      : `${collection.limitations.length.toString()} required checks failed; no clean conclusion was made.`,
    checks: collection.checks,
    evidence: collection.evidence,
    findings: collection.findings,
    limitations: collection.limitations,
    actions: collection.findings.map((finding) => `Review: ${finding.summary}`),
    ...(synthesis === undefined ? {} : { synthesis }),
    provenance: {
      source:
        "typed Prometheus, Alerts, Temporal, Kubernetes, ArgoCD, and Buildkite collectors",
      windowStart: collection.startedAt,
      windowEnd: collection.completedAt,
      query: "current health plus Temporal/Buildkite 24-hour failure windows",
    },
  };
}
