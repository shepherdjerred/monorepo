import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { DeadLink, LinkRotScanResult } from "#activities/link-rot-scan.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { runLinkRotScanWorkflow } from "./link-rot-scan.ts";

// The workflow deliberately splits queues: the git/lychee scan runs on the
// serial MAINTENANCE queue while delivery and the Alertmanager publish stay on
// the credentialed core queue. The test mirrors that with one worker per queue,
// which also proves the routing — a single-queue harness would hang.
const REPO_SHA = "d9ea9584e0123456789abcdef0123456789abcde";

let testEnv: TestWorkflowEnvironment;

beforeAll(async () => {
  testEnv = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnv.teardown();
});

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
    deadLinks,
    timedOutLinks: [],
    excerpt: "fixture",
  };
}

async function runWorkflow(
  overrides: {
    scan?: () => Promise<LinkRotScanResult>;
    publish?: () => Promise<void>;
  },
  deadLinks: DeadLink[] = [],
): Promise<{ harness: Harness; failure: unknown }> {
  const harness: Harness = { reports: [], alerts: [] };
  const coreWorker = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue: TASK_QUEUES.DEFAULT,
    workflowsPath: new URL("index.ts", import.meta.url).pathname,
    activities: {
      deliverActivityReport: (input: unknown) => {
        harness.reports.push(DeliveredReportSchema.parse(input));
        return { accepted: true, duplicate: false, reportRunId: "report-1" };
      },
      publishLinkRotScanAlerts:
        overrides.publish ??
        ((input: unknown) => {
          harness.alerts.push(PublishedAlertSchema.parse(input));
          return Promise.resolve();
        }),
    },
  });
  const maintenanceWorker = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue: TASK_QUEUES.MAINTENANCE,
    activities: {
      scanMainForLinkRot: overrides.scan ?? (async () => scanResult(deadLinks)),
    },
  });

  const execution = testEnv.client.workflow.execute(runLinkRotScanWorkflow, {
    args: [],
    taskQueue: TASK_QUEUES.DEFAULT,
    workflowId: `test-link-rot-scan-${crypto.randomUUID()}`,
  });

  let failure: unknown;
  try {
    await Promise.all([
      coreWorker.runUntil(execution),
      maintenanceWorker.runUntil(execution),
    ]);
  } catch (error: unknown) {
    failure = error;
  }
  return { harness, failure };
}

describe("runLinkRotScanWorkflow", () => {
  it("delivers one clear report and resolves the alert on a clean scan", async () => {
    const { harness, failure } = await runWorkflow({});
    expect(failure).toBeUndefined();
    expect(harness.reports).toEqual([
      { execution: "complete", verdict: "clear" },
    ]);
    expect(harness.alerts).toEqual([{ criticalCount: 0, repoSha: REPO_SHA }]);
  }, 60_000);

  it("reports dead links as warnings without paging", async () => {
    const { harness, failure } = await runWorkflow({}, [DEAD_LINK]);
    expect(failure).toBeUndefined();
    expect(harness.reports).toEqual([
      { execution: "complete", verdict: "attention" },
    ]);
    // Dead links are warning findings by policy, so the occurrence resolves.
    expect(harness.alerts).toEqual([{ criticalCount: 0, repoSha: REPO_SHA }]);
  }, 60_000);

  it("delivers a failed report before rethrowing a scan failure", async () => {
    const { harness, failure } = await runWorkflow({
      scan: () => {
        throw new Error("lychee configuration invalid");
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
    expect(harness.reports).toEqual([
      { execution: "complete", verdict: "attention" },
    ]);
    expect(
      harness.reports.some((report) => report.execution === "failed"),
    ).toBe(false);
  }, 120_000);
});
