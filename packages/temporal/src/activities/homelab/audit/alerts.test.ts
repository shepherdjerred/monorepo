import { describe, expect, test } from "vitest";
import {
  deduplicateAuditFindings,
  interpretAlertOccurrences,
  interpretPrometheusAlerts,
} from "./alerts.ts";
import { buildHomelabAuditReport } from "#activities/homelab/homelab-audit-report.ts";

const labels = {
  alertname: "DiskFull",
  namespace: "scout",
  severity: "critical",
  pod: "db-0",
};
const occurrence = {
  id: "alert-1",
  alertname: labels.alertname,
  namespace: labels.namespace,
  severity: "critical" as const,
  summary: "Disk space is low",
  lifecycleState: "open" as const,
  suppressionState: "none" as const,
  labels,
};

describe("homelab audit alert reconciliation", () => {
  test("preserves severity and treats heartbeat rules as informational", () => {
    const result = interpretPrometheusAlerts([
      { metric: labels },
      { metric: { alertname: "Info", severity: "info" } },
      { metric: { alertname: "Watchdog", severity: "warning" } },
      { metric: { alertname: "InfoInhibitor" } },
      { metric: { alertname: "Unclassified" } },
    ]);
    expect(result.findings.map((finding) => finding.severity)).toEqual([
      "critical",
      "info",
      "info",
      "info",
      "warning",
    ]);
  });

  test("merges matching sources and retains distinct pods and evidence", () => {
    const prometheus = interpretPrometheusAlerts([
      { metric: { ...labels, __name__: "ALERTS", alertstate: "firing" } },
      { metric: { ...labels, pod: "db-1" } },
    ]).findings.map((finding) => ({
      ...finding,
      evidenceReceiptIds: ["prometheus"],
    }));
    const ledger = interpretAlertOccurrences([
      {
        ...occurrence,
        suppressionState: "inhibited",
        labels: {
          ...labels,
          prometheus: "prometheus/main",
          prometheus_replica: "a",
        },
      },
    ]).findings.map((finding) => ({
      ...finding,
      evidenceReceiptIds: ["ledger"],
    }));
    const findings = deduplicateAuditFindings([...prometheus, ...ledger]);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      severity: "info",
      state: "suppressed",
      evidenceReceiptIds: ["prometheus", "ledger"],
    });
    expect(findings[1]).toMatchObject({
      severity: "critical",
      state: "active",
    });
    expect(findings[0]?.detail).toContain("sourceSeverity=critical");
  });

  test("silencing is visible without producing an action-needed verdict", () => {
    const findings = interpretAlertOccurrences([
      { ...occurrence, suppressionState: "silenced" },
    ]).findings.map((finding) => ({
      ...finding,
      evidenceReceiptIds: ["ledger"],
    }));
    const report = buildHomelabAuditReport(
      {
        startedAt: "2026-10-09T12:00:00Z",
        completedAt: "2026-10-09T12:01:00Z",
        checks: [
          {
            id: "ledger",
            label: "Alerts",
            required: true,
            status: "passed",
            summary: "1 suppressed",
            evidenceReceiptIds: ["ledger"],
          },
        ],
        evidence: [
          {
            id: "ledger",
            source: "Alerts",
            observedAt: "2026-10-09T12:00:00Z",
            status: "success",
          },
        ],
        findings,
        limitations: [],
      },
      undefined,
    );
    expect(report.verdict).toBe("clear");
    expect(report.actions).toEqual([]);
    expect(report.findings).toHaveLength(1);
  });

  test("unprocessed and unknown alerts remain actionable", () => {
    expect(
      interpretAlertOccurrences([
        { ...occurrence, severity: "unknown", suppressionState: "unprocessed" },
      ]).findings[0],
    ).toMatchObject({ severity: "warning", state: "active" });
  });
});
