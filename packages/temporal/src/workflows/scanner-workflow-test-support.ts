import { afterAll, beforeAll, expect } from "vitest";
import { z } from "zod/v4";
import { Worker } from "@temporalio/worker";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import type { PatchActivationCallback } from "@temporalio/worker";
import type { TaskQueue } from "#shared/task-queues.ts";

const DeliveredReportSchema = z.object({
  execution: z.string().min(1),
  verdict: z.string().min(1),
});
const PublishedAlertSchema = z.object({
  criticalCount: z.number().int().nonnegative(),
  repoSha: z.string().min(1),
});

export type ScannerWorkflowHarness = {
  reports: z.infer<typeof DeliveredReportSchema>[];
  alerts: z.infer<typeof PublishedAlertSchema>[];
};

export type ScannerWorkerDefinition = {
  taskQueue: TaskQueue;
  activities: object;
  runsWorkflow?: boolean;
};

export function setupScannerWorkflowTestEnvironment(): () => TestWorkflowEnvironment {
  let testEnv: TestWorkflowEnvironment | undefined;
  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
  }, 60_000);
  afterAll(async () => {
    if (testEnv === undefined) {
      throw new Error("scanner workflow test environment was never created");
    }
    await testEnv.teardown();
  });
  return () => {
    if (testEnv === undefined) {
      throw new Error("scanner workflow test environment is unavailable");
    }
    return testEnv;
  };
}

export function createScannerWorkflowHarness(): ScannerWorkflowHarness {
  return { reports: [], alerts: [] };
}

export function deliverScannerReport(harness: ScannerWorkflowHarness): (
  input: unknown,
) => {
  accepted: boolean;
  duplicate: boolean;
  reportRunId: string;
} {
  return (input) => {
    harness.reports.push(DeliveredReportSchema.parse(input));
    return { accepted: true, duplicate: false, reportRunId: "report-1" };
  };
}

export function publishScannerAlert(
  harness: ScannerWorkflowHarness,
  override?: () => Promise<void>,
): (input: unknown) => Promise<void> {
  return (input) => {
    if (override !== undefined) {
      return override();
    }
    harness.alerts.push(PublishedAlertSchema.parse(input));
    return Promise.resolve();
  };
}

export async function runScannerWorkflow(
  testEnv: TestWorkflowEnvironment,
  input: {
    workflow: () => Promise<void>;
    workflowId: string;
    taskQueue: TaskQueue;
    workers: readonly ScannerWorkerDefinition[];
    patchActivationCallback?: PatchActivationCallback;
  },
): Promise<unknown> {
  const workers = await Promise.all(
    input.workers.map(async (definition) => ({
      definition,
      worker: await Worker.create({
        connection: testEnv.nativeConnection,
        // Each scanner test worker registers against canonical production
        // queues. A unique build ID keeps concurrent Vitest suites from
        // colliding in the test server's worker registry.
        buildId: `scanner-test-${crypto.randomUUID()}`,
        taskQueue: definition.taskQueue,
        activities: definition.activities,
        ...(definition.runsWorkflow === true
          ? { workflowsPath: new URL("index.ts", import.meta.url).pathname }
          : {}),
        ...(input.patchActivationCallback === undefined
          ? {}
          : { patchActivationCallback: input.patchActivationCallback }),
      }),
    })),
  );
  const workflowWorker = workers.find(
    ({ definition }) => definition.runsWorkflow === true,
  );
  if (workflowWorker === undefined) {
    throw new Error("scanner workflow harness requires a workflow worker");
  }
  const activityWorkers = workers.filter(
    ({ definition }) => definition.runsWorkflow !== true,
  );
  const activityRuns = activityWorkers.map(({ worker }) => worker.run());
  const execution = testEnv.client.workflow.execute(input.workflow, {
    args: [],
    taskQueue: input.taskQueue,
    workflowId: input.workflowId,
  });
  const workflowState: { outcome: "pending" | "fulfilled" | "rejected" } = {
    outcome: "pending",
  };
  const observedExecution = (async () => {
    try {
      await execution;
      workflowState.outcome = "fulfilled";
    } catch (error: unknown) {
      workflowState.outcome = "rejected";
      throw error;
    }
  })();
  try {
    await workflowWorker.worker.runUntil(observedExecution);
    return undefined;
  } catch (error: unknown) {
    if (workflowState.outcome === "fulfilled") {
      await observedExecution;
      return undefined;
    }
    return error;
  } finally {
    for (const { worker } of activityWorkers) {
      worker.shutdown();
    }
    await Promise.all(activityRuns);
  }
}

export function expectCompleteScannerReport(
  harness: ScannerWorkflowHarness,
  verdict: "attention" | "clear",
  criticalCount: number,
  repoSha: string,
): void {
  expect(harness.reports).toEqual([{ execution: "complete", verdict }]);
  expect(harness.alerts).toEqual([{ criticalCount, repoSha }]);
}

export function expectFailedScannerReport(
  harness: ScannerWorkflowHarness,
): void {
  expect(harness.reports).toEqual([
    { execution: "failed", verdict: "inconclusive" },
  ]);
  expect(harness.alerts).toEqual([]);
}

export function expectNoContradictoryFailureReport(
  harness: ScannerWorkflowHarness,
  verdict: "attention" | "clear",
): void {
  expect(harness.reports).toEqual([{ execution: "complete", verdict }]);
  expect(harness.reports.some((report) => report.execution === "failed")).toBe(
    false,
  );
}
