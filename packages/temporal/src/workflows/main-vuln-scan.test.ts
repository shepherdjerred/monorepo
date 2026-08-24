import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { MainVulnScanResult } from "#activities/main-vuln-scan.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { runMainVulnScanWorkflow } from "./main-vuln-scan.ts";

// The workflow proxies report delivery and the Alertmanager publish to
// TASK_QUEUES.DEFAULT, so the test worker polls that queue and the workflow is
// started on it — otherwise those activities are scheduled to a queue nothing
// is polling and the workflow blocks forever.
const TASK_QUEUE = TASK_QUEUES.DEFAULT;
const REPO_SHA = "d9ea9584e0123456789abcdef0123456789abcde";

let testEnv: TestWorkflowEnvironment;

beforeAll(async () => {
  testEnv = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnv.teardown();
});

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

// Activity inputs arrive as `unknown` through the Temporal payload boundary;
// narrow them with Zod rather than a type assertion.
const DeliveredReportSchema = z.object({
  execution: z.string().min(1),
  verdict: z.string().min(1),
});
const PublishedAlertSchema = z.object({
  criticalCount: z.number().int().nonnegative(),
  repoSha: z.string().min(1),
});

type Harness = {
  reports: z.infer<typeof DeliveredReportSchema>[];
  alerts: z.infer<typeof PublishedAlertSchema>[];
};

async function runWorkflow(
  overrides: {
    scan?: () => Promise<MainVulnScanResult>;
    publish?: () => Promise<void>;
  },
  vulnerabilities: MainVulnScanResult["vulnerabilities"] = [],
): Promise<{ harness: Harness; failure: unknown }> {
  const harness: Harness = { reports: [], alerts: [] };
  const worker = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: new URL("index.ts", import.meta.url).pathname,
    activities: {
      scanMainForVulnerabilities:
        overrides.scan ?? (async () => scanResult(vulnerabilities)),
      deliverActivityReport: (input: unknown) => {
        harness.reports.push(DeliveredReportSchema.parse(input));
        return { accepted: true, duplicate: false, reportRunId: "report-1" };
      },
      publishMainVulnScanAlerts:
        overrides.publish ??
        ((input: unknown) => {
          harness.alerts.push(PublishedAlertSchema.parse(input));
          return Promise.resolve();
        }),
    },
  });

  let failure: unknown;
  try {
    await worker.runUntil(
      testEnv.client.workflow.execute(runMainVulnScanWorkflow, {
        args: [],
        taskQueue: TASK_QUEUE,
        workflowId: `test-main-vuln-scan-${crypto.randomUUID()}`,
      }),
    );
  } catch (error: unknown) {
    failure = error;
  }
  return { harness, failure };
}

describe("runMainVulnScanWorkflow", () => {
  it("delivers one clear report and resolves the alert on a clean scan", async () => {
    const { harness, failure } = await runWorkflow({});
    expect(failure).toBeUndefined();
    expect(harness.reports).toEqual([
      { execution: "complete", verdict: "clear" },
    ]);
    expect(harness.alerts).toEqual([{ criticalCount: 0, repoSha: REPO_SHA }]);
  }, 60_000);

  it("fires the alert with the critical count when findings exist", async () => {
    const { harness, failure } = await runWorkflow({}, [
      CRITICAL_VULNERABILITY,
    ]);
    expect(failure).toBeUndefined();
    expect(harness.reports).toEqual([
      { execution: "complete", verdict: "attention" },
    ]);
    expect(harness.alerts).toEqual([{ criticalCount: 1, repoSha: REPO_SHA }]);
  }, 60_000);

  it("delivers a failed report before rethrowing a scan failure", async () => {
    const { harness, failure } = await runWorkflow({
      scan: () => {
        throw new Error("trivy database unavailable");
      },
    });
    expect(failure).toBeInstanceOf(Error);
    expect(harness.reports).toEqual([
      { execution: "failed", verdict: "inconclusive" },
    ]);
    expect(harness.alerts).toEqual([]);
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
    expect(harness.reports).toEqual([
      { execution: "complete", verdict: "attention" },
    ]);
    expect(
      harness.reports.some((report) => report.execution === "failed"),
    ).toBe(false);
  }, 120_000);
});
