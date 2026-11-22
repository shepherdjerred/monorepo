import { describe, expect, it } from "vitest";
import type {
  DeadLink,
  LinkRotScanResult,
} from "#activities/maintenance/link-rot/link-rot-scan.ts";
import type { ReportRemediationV1 } from "#shared/reports/report.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { runLinkRotScanWorkflow } from "./link-rot-scan.ts";
import * as scannerTest from "./scanner-workflow-test-support.ts";

// The workflow deliberately splits queues: the git/lychee scan runs on the
// serial MAINTENANCE queue, Codex remediation runs on REPO_AUTOMATION, and
// delivery + Alertmanager publish stay on the credentialed REPORTS queue.
const REPO_SHA = "d9ea9584e0123456789abcdef0123456789abcde";

const getTestEnv = scannerTest.setupScannerWorkflowTestEnvironment();

const DEAD_LINK: DeadLink = {
  url: "https://github.com/shepherdjerred/definitely-missing",
  source: "README.md",
  status: "Rejected status code: 404 Not Found",
  statusCode: 404,
  line: 12,
};

function scanResult(deadLinks: DeadLink[]): LinkRotScanResult {
  return {
    observedAt: "2026-08-23T12:00:00.000Z",
    repoSha: REPO_SHA,
    command: "lychee --config lychee.toml --format json --no-progress .",
    exitCode: deadLinks.length === 0 ? 0 : 2,
    totalLinks: 120,
    successfulLinks: 120 - deadLinks.length,
    excludedLinks: 2,
    ignoredRootRelativeLinks: 0,
    deadLinks,
    timedOutLinks: [],
    excerpt: "fixture",
  };
}

async function runWorkflow(
  overrides: {
    scan?: () => Promise<LinkRotScanResult>;
    remediate?: (input: LinkRotScanResult) => Promise<ReportRemediationV1>;
    publish?: () => Promise<void>;
  },
  deadLinks: DeadLink[] = [],
  options: { workflowId?: string } = {},
): Promise<{ harness: scannerTest.ScannerWorkflowHarness; failure: unknown }> {
  const harness = scannerTest.createScannerWorkflowHarness();
  const workflowId =
    options.workflowId ?? `test-link-rot-scan-${crypto.randomUUID()}`;
  const failure = await scannerTest.runScannerWorkflow(getTestEnv(), {
    workflow: runLinkRotScanWorkflow,
    workflowId,
    taskQueue: TASK_QUEUES.MAINTENANCE,
    workers: [
      {
        taskQueue: TASK_QUEUES.REPORTS,
        activities: {
          deliverActivityReport: scannerTest.deliverScannerReport(harness),
          publishLinkRotScanAlerts: scannerTest.publishScannerAlert(
            harness,
            overrides.publish,
          ),
        },
      },
      {
        taskQueue: TASK_QUEUES.REPO_AUTOMATION,
        activities: {
          remediateLinkRot:
            overrides.remediate ??
            (async (input: LinkRotScanResult) => ({
              outcome: "no-changes" as const,
              changedFiles: [],
              resolvedCount: 0,
              unresolvedCount: input.deadLinks.length,
              summary: "No automatic dead-link replacement verified.",
            })),
        },
      },
      {
        taskQueue: TASK_QUEUES.MAINTENANCE,
        activities: {
          scanMainForLinkRot:
            overrides.scan ?? (async () => scanResult(deadLinks)),
        },
        runsWorkflow: true,
      },
    ],
  });
  return { harness, failure };
}

describe("runLinkRotScanWorkflow", () => {
  it("delivers one clear report and resolves the alert on a clean scan without calling remediation", async () => {
    let remediationCalled = false;
    const { harness, failure } = await runWorkflow({
      remediate: () => {
        remediationCalled = true;
        return Promise.resolve({ outcome: "no-changes", changedFiles: [] });
      },
    });
    expect(failure).toBeUndefined();
    expect(remediationCalled).toBe(false);
    scannerTest.expectCompleteScannerReport(harness, "clear", 0, REPO_SHA);
  }, 60_000);

  it("reports dead links as warnings without paging when remediation makes no changes", async () => {
    const { harness, failure } = await runWorkflow({}, [DEAD_LINK]);
    expect(failure).toBeUndefined();
    // Dead links are warning findings by policy, so the occurrence resolves.
    scannerTest.expectCompleteScannerReport(harness, "attention", 0, REPO_SHA);
  }, 60_000);

  it("delivers a changed report with remediation PR when all dead links are resolved", async () => {
    const { harness, failure } = await runWorkflow(
      {
        remediate: () =>
          Promise.resolve({
            outcome: "pr-created",
            prUrl: "https://github.com/shepherdjerred/monorepo/pull/600",
            branchName: "chore/link-rot-11223344",
            commitSha: "112233445566",
            autoMergeEnabled: true,
            changedFiles: ["README.md"],
            resolvedCount: 1,
            unresolvedCount: 0,
            summary: "lychee verified 1/1 dead links resolved.",
          }),
      },
      [DEAD_LINK],
    );
    expect(failure).toBeUndefined();
    scannerTest.expectCompleteScannerReport(harness, "changed", 0, REPO_SHA);
    expect(harness.reports[0]?.remediation?.prUrl).toBe(
      "https://github.com/shepherdjerred/monorepo/pull/600",
    );
  }, 60_000);

  it("still delivers the scan report with a partial remediation note when Codex remediation fails", async () => {
    const { harness, failure } = await runWorkflow(
      {
        remediate: () => Promise.reject(new Error("Codex API unavailable")),
      },
      [DEAD_LINK],
    );
    expect(failure).toBeUndefined();
    scannerTest.expectCompleteScannerReport(harness, "attention", 0, REPO_SHA);
    expect(harness.reports[0]?.remediation?.outcome).toBe("partial");
    expect(harness.reports[0]?.remediation?.summary).toContain(
      "Codex API unavailable",
    );
  }, 60_000);

  it("delivers a failed report before rethrowing a scan failure", async () => {
    const { harness, failure } = await runWorkflow({
      scan: () => {
        throw new Error("lychee configuration invalid");
      },
    });
    expect(failure).toBeInstanceOf(Error);
    scannerTest.expectFailedScannerReport(harness);
  }, 60_000);

  it("never contradicts a delivered scan report when the alert publish fails", async () => {
    // Regression guard: an Alertmanager outage after a successful scan and a
    // delivered report must not send a second report claiming the scan failed
    // and produced no verdict.
    const { harness, failure } = await runWorkflow(
      {
        publish: () => {
          throw new Error("alertmanager unreachable");
        },
      },
      [DEAD_LINK],
    );
    expect(failure).toBeInstanceOf(Error);
    scannerTest.expectNoContradictoryFailureReport(harness, "attention");
  }, 120_000);
});
