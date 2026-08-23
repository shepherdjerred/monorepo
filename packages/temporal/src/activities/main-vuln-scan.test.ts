import { describe, expect, test } from "vitest";
import {
  buildScanExcerpt,
  parseTrivyReport,
  type MainVulnScanResult,
} from "./main-vuln-scan.ts";
import {
  buildMainVulnScanFailureReport,
  buildMainVulnScanReport,
  countCriticalVulnerabilities,
} from "./main-vuln-scan-report.ts";

// Mirrors the real `trivy fs --format json --severity HIGH,CRITICAL` shape:
// Results keyed by Target, Vulnerabilities omitted entirely on clean targets.
const TRIVY_FIXTURE = JSON.stringify({
  SchemaVersion: 2,
  ArtifactName: ".",
  Results: [
    {
      Target: "bun.lock",
      Class: "lang-pkgs",
      Type: "bun",
      Vulnerabilities: [
        {
          VulnerabilityID: "CVE-2026-1234",
          PkgName: "left-pad",
          InstalledVersion: "1.3.0",
          FixedVersion: "1.3.1",
          Severity: "CRITICAL",
          Title: "left-pad arbitrary code execution",
          PrimaryURL: "https://avd.aquasec.com/nvd/cve-2026-1234",
        },
        {
          VulnerabilityID: "CVE-2026-5678",
          PkgName: "chalk",
          InstalledVersion: "5.0.0",
          Severity: "HIGH",
        },
      ],
    },
    { Target: "packages/monarch/requirements.txt", Class: "lang-pkgs" },
  ],
});

describe("parseTrivyReport", () => {
  test("maps Results[].Vulnerabilities[] to typed findings", () => {
    const vulnerabilities = parseTrivyReport(TRIVY_FIXTURE);
    expect(vulnerabilities).toEqual([
      {
        vulnerabilityId: "CVE-2026-1234",
        pkgName: "left-pad",
        installedVersion: "1.3.0",
        fixedVersion: "1.3.1",
        severity: "CRITICAL",
        target: "bun.lock",
        title: "left-pad arbitrary code execution",
        primaryUrl: "https://avd.aquasec.com/nvd/cve-2026-1234",
      },
      {
        vulnerabilityId: "CVE-2026-5678",
        pkgName: "chalk",
        installedVersion: "5.0.0",
        severity: "HIGH",
        target: "bun.lock",
      },
    ]);
  });

  test("a clean scan (no Results) parses to zero findings", () => {
    expect(parseTrivyReport(JSON.stringify({ SchemaVersion: 2 }))).toEqual([]);
  });

  test("rejects a severity outside the requested HIGH/CRITICAL set", () => {
    const drifted = JSON.stringify({
      Results: [
        {
          Target: "bun.lock",
          Vulnerabilities: [
            {
              VulnerabilityID: "CVE-2026-9999",
              PkgName: "x",
              InstalledVersion: "1.0.0",
              Severity: "MEDIUM",
            },
          ],
        },
      ],
    });
    expect(() => parseTrivyReport(drifted)).toThrow();
  });

  test("rejects non-JSON output instead of returning empty", () => {
    expect(() => parseTrivyReport("not json")).toThrow();
  });
});

describe("buildScanExcerpt", () => {
  test("summarizes findings and stays inside the receipt bound", () => {
    const vulnerabilities = parseTrivyReport(TRIVY_FIXTURE);
    const excerpt = buildScanExcerpt(vulnerabilities);
    expect(excerpt).toContain("2 HIGH/CRITICAL:");
    expect(excerpt).toContain("CRITICAL CVE-2026-1234 left-pad@1.3.0");
    expect(excerpt.length).toBeLessThanOrEqual(2000);
  });

  test("names the clean state explicitly", () => {
    expect(buildScanExcerpt([])).toBe("0 HIGH/CRITICAL vulnerabilities");
  });

  test("never exceeds the receipt bound on a noisy scan", () => {
    const many = Array.from({ length: 200 }, (_, index) => ({
      vulnerabilityId: `CVE-2026-${String(index)}`,
      pkgName: "pkg",
      installedVersion: "1.0.0",
      severity: "HIGH" as const,
      target: "bun.lock",
    }));
    expect(buildScanExcerpt(many).length).toBeLessThanOrEqual(2000);
  });
});

function scanResult(
  vulnerabilities: MainVulnScanResult["vulnerabilities"],
): MainVulnScanResult {
  return {
    observedAt: "2026-08-23T12:00:00.000Z",
    repoSha: "d9ea9584e0123456789abcdef0123456789abcde",
    command: "trivy fs --format json .",
    exitCode: 0,
    vulnerabilities,
    excerpt: buildScanExcerpt(vulnerabilities),
  };
}

describe("buildMainVulnScanReport", () => {
  test("a clean scan is a clear, complete report with zero findings", () => {
    const report = buildMainVulnScanReport(
      "2026-08-23T11:55:00.000Z",
      scanResult([]),
    );
    expect(report.verdict).toBe("clear");
    expect(report.execution).toBe("complete");
    expect(report.findings).toEqual([]);
    expect(report.actions).toEqual([]);
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]?.status).toBe("passed");
    expect(report.headline).toContain("no HIGH/CRITICAL");
  });

  test("findings map HIGH to warning and CRITICAL to critical", () => {
    const report = buildMainVulnScanReport(
      "2026-08-23T11:55:00.000Z",
      scanResult(parseTrivyReport(TRIVY_FIXTURE)),
    );
    expect(report.verdict).toBe("attention");
    expect(report.findings.map((finding) => finding.severity)).toEqual([
      "critical",
      "warning",
    ]);
    expect(report.findings[0]?.section).toBe("Critical vulnerabilities");
    expect(report.findings[1]?.section).toBe("High vulnerabilities");
    expect(report.findings[0]?.summary).toBe(
      "CVE-2026-1234: left-pad@1.3.0 (CRITICAL)",
    );
    expect(report.findings[0]?.detail).toContain("Fixed in: 1.3.1");
    expect(report.findings[1]?.detail).toContain(
      "No fixed version published yet",
    );
    // Every finding cites the single scan receipt.
    for (const finding of report.findings) {
      expect(finding.evidenceReceiptIds).toEqual(["trivy-scan"]);
    }
    expect(report.evidence[0]?.id).toBe("trivy-scan");
    expect(report.evidence[0]?.command).toContain("trivy fs");
    expect(report.headline).toContain("1 CRITICAL and 1 HIGH");
  });

  test("critical count feeds the alert decision", () => {
    expect(
      countCriticalVulnerabilities(scanResult(parseTrivyReport(TRIVY_FIXTURE))),
    ).toBe(1);
    expect(countCriticalVulnerabilities(scanResult([]))).toBe(0);
  });
});

describe("buildMainVulnScanFailureReport", () => {
  test("a failed scan reports failed execution with the error excerpt", () => {
    const report = buildMainVulnScanFailureReport(
      "2026-08-23T11:55:00.000Z",
      new Error("trivy exited 1: DB is corrupted"),
    );
    expect(report.execution).toBe("failed");
    expect(report.verdict).toBe("inconclusive");
    expect(report.checks[0]?.status).toBe("failed");
    expect(report.evidence[0]?.excerpt).toContain("DB is corrupted");
  });
});
