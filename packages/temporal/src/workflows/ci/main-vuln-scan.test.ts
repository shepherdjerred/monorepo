import { describe, expect, it } from "vitest";
import type { MainVulnScanResult } from "#activities/maintenance/main-vuln-scan.ts";
import type { ReportRemediationV1 } from "#shared/reports/report.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { runMainVulnScanWorkflow } from "./main-vuln-scan.ts";
import * as scannerTest from "#workflows/scanner-workflow-test-support.ts";

const REPO_SHA = "d9ea9584e0123456789abcdef0123456789abcde";

const getTestEnv = scannerTest.setupScannerWorkflowTestEnvironment();

function scanResult(
  vulnerabilities: MainVulnScanResult["vulnerabilities"],
): MainVulnScanResult {
  return {
    observedAt: "2026-08-23T12:00:00.000Z",
    repoSha: REPO_SHA,
    command: "trivy fs --format json .",
    exitCode: 0,
    vulnerabilities,
    excerpt: "fixture",
  };
}

const CRITICAL_VULNERABILITY = {
  vulnerabilityId: "CVE-2026-1234",
  pkgName: "left-pad",
  installedVersion: "1.3.0",
  severity: "CRITICAL" as const,
  target: "bun.lock",
};

const FIXABLE_CRITICAL_VULNERABILITY = {
  ...CRITICAL_VULNERABILITY,
  fixedVersion: "1.3.1",
};

async function runWorkflow(
  overrides: {
    scan?: () => Promise<MainVulnScanResult>;
    remediate?: (input: MainVulnScanResult) => Promise<ReportRemediationV1>;
    publish?: () => Promise<void>;
  },
  vulnerabilities: MainVulnScanResult["vulnerabilities"] = [],
  options: { workflowId?: string } = {},
): Promise<{ harness: scannerTest.ScannerWorkflowHarness; failure: unknown }> {
  const harness = scannerTest.createScannerWorkflowHarness();
  const workflowId =
    options.workflowId ?? `test-main-vuln-scan-${crypto.randomUUID()}`;
  const failure = await scannerTest.runScannerWorkflow(getTestEnv(), {
    workflow: runMainVulnScanWorkflow,
    workflowId,
    taskQueue: TASK_QUEUES.MAINTENANCE,
    workers: [
      {
        taskQueue: TASK_QUEUES.REPORTS,
        activities: {
          deliverActivityReport: scannerTest.deliverScannerReport(harness),
          publishMainVulnScanAlerts: scannerTest.publishScannerAlert(
            harness,
            overrides.publish,
          ),
        },
      },
      {
        taskQueue: TASK_QUEUES.REPO_AUTOMATION,
        activities: {
          remediateMainVulnerabilities:
            overrides.remediate ??
            (async () => ({
              outcome: "no-changes" as const,
              changedFiles: [],
              resolvedCount: 0,
              unresolvedCount: 1,
              summary: "No upgrade verified.",
            })),
        },
      },
      {
        taskQueue: TASK_QUEUES.MAINTENANCE,
        activities: {
          scanMainForVulnerabilities:
            overrides.scan ?? (async () => scanResult(vulnerabilities)),
        },
        runsWorkflow: true,
      },
    ],
  });
  return { harness, failure };
}

describe("runMainVulnScanWorkflow", () => {
  it("delivers one clear report and resolves the alert on a clean scan", async () => {
    const { harness, failure } = await runWorkflow({});
    expect(failure).toBeUndefined();
    scannerTest.expectCompleteScannerReport(harness, "clear", 0, REPO_SHA);
  }, 60_000);

  it("fires the alert with the critical count without calling remediation when no fixedVersion exists", async () => {
    let remediationCalled = false;
    const { harness, failure } = await runWorkflow(
      {
        remediate: () => {
          remediationCalled = true;
          return Promise.resolve({ outcome: "no-changes", changedFiles: [] });
        },
      },
      [CRITICAL_VULNERABILITY],
    );
    expect(failure).toBeUndefined();
    expect(remediationCalled).toBe(false);
    scannerTest.expectCompleteScannerReport(harness, "attention", 1, REPO_SHA);
  }, 60_000);

  it("opens a review remediation PR for fixable advisories while still firing critical Alertmanager alert until main is clean", async () => {
    const { harness, failure } = await runWorkflow(
      {
        remediate: () =>
          Promise.resolve({
            outcome: "pr-created",
            prUrl: "https://github.com/shepherdjerred/monorepo/pull/800",
            branchName: "chore/vuln-remediation-12345678",
            commitSha: "1234567890ab",
            autoMergeEnabled: false,
            changedFiles: ["bun.lock"],
            resolvedCount: 1,
            unresolvedCount: 0,
            summary: "Upgraded left-pad to 1.3.1.",
          }),
      },
      [FIXABLE_CRITICAL_VULNERABILITY],
    );
    expect(failure).toBeUndefined();
    scannerTest.expectCompleteScannerReport(harness, "attention", 1, REPO_SHA);
    expect(harness.reports[0]?.remediation?.prUrl).toBe(
      "https://github.com/shepherdjerred/monorepo/pull/800",
    );
    expect(harness.reports[0]?.remediation?.autoMergeEnabled).toBe(false);
  }, 60_000);

  it("isolates remediation errors so scan report and critical Alertmanager alert still publish", async () => {
    const { harness, failure } = await runWorkflow(
      {
        remediate: () => Promise.reject(new Error("Codex timeout")),
      },
      [FIXABLE_CRITICAL_VULNERABILITY],
    );
    expect(failure).toBeUndefined();
    scannerTest.expectCompleteScannerReport(harness, "attention", 1, REPO_SHA);
    expect(harness.reports[0]?.remediation?.outcome).toBe("partial");
  }, 60_000);

  it("delivers a failed report before rethrowing a scan failure", async () => {
    const { harness, failure } = await runWorkflow({
      scan: () => {
        throw new Error("trivy database unavailable");
      },
    });
    expect(failure).toBeInstanceOf(Error);
    scannerTest.expectFailedScannerReport(harness);
  }, 60_000);

  it("never contradicts a delivered scan report when the alert publish fails", async () => {
    // Regression guard: an Alertmanager outage after a successful scan and a
    // delivered report must not send a second report claiming the scan failed.
    // The workflow fails (temporal-failure-watch raises its own occurrence)
    // with exactly one, accurate report on the wire.
    const { harness, failure } = await runWorkflow(
      {
        publish: () => {
          throw new Error("alertmanager unreachable");
        },
      },
      [CRITICAL_VULNERABILITY],
    );
    expect(failure).toBeInstanceOf(Error);
    scannerTest.expectNoContradictoryFailureReport(harness, "attention");
  }, 120_000);
});
