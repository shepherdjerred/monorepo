import { Worker, type WorkerOptions } from "@temporalio/worker";
import type { TestWorkflowEnvironment } from "@temporalio/testing";
import { TASK_QUEUES } from "#shared/task-queues.ts";

export function createReportCapture(reportRunId: string): {
  reports: unknown[];
  deliverActivityReport: (input: unknown) => {
    accepted: boolean;
    duplicate: boolean;
    reportRunId: string;
  };
} {
  const reports: unknown[] = [];
  const deliverActivityReport = (input: unknown) => {
    reports.push(input);
    return { accepted: true, duplicate: false, reportRunId };
  };
  return { reports, deliverActivityReport };
}

export async function runWorkflowWithActivityWorker<T>(
  environment: TestWorkflowEnvironment,
  options: {
    activityTaskQueue: string;
    workflowPath: string;
    activities: NonNullable<WorkerOptions["activities"]>;
    execute: () => Promise<T>;
  },
): Promise<T> {
  const workflowWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.WORKFLOWS,
    workflowsPath: options.workflowPath,
  });
  const activityWorker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: options.activityTaskQueue,
    activities: options.activities,
  });
  const activityRun = activityWorker.run();
  try {
    const workflowResult = options.execute();
    const workflowState: {
      outcome: "pending" | "fulfilled" | "rejected";
    } = { outcome: "pending" };
    const observedWorkflowResult = (async () => {
      try {
        const value = await workflowResult;
        workflowState.outcome = "fulfilled";
        return value;
      } catch (error: unknown) {
        workflowState.outcome = "rejected";
        throw error;
      }
    })();
    try {
      return await workflowWorker.runUntil(observedWorkflowResult);
    } catch {
      return await observedWorkflowResult;
    }
  } finally {
    activityWorker.shutdown();
    await activityRun;
  }
}

export async function runWithReportWorker(
  testEnvironment: TestWorkflowEnvironment,
  primaryWorker: Worker,
  deliverActivityReport: (input: never) => unknown,
  options: {
    reportTaskQueue: string;
    runWorkflow: () => Promise<unknown>;
  },
): Promise<unknown> {
  const reportWorker = await Worker.create({
    connection: testEnvironment.nativeConnection,
    taskQueue: options.reportTaskQueue,
    activities: { deliverActivityReport },
  });
  const reportRun = reportWorker.run();
  try {
    const workflowResult = options.runWorkflow();
    const workflowState: {
      outcome: "pending" | "fulfilled" | "rejected";
    } = { outcome: "pending" };
    const observedWorkflowResult = (async () => {
      try {
        const value = await workflowResult;
        workflowState.outcome = "fulfilled";
        return value;
      } catch (error: unknown) {
        workflowState.outcome = "rejected";
        throw error;
      }
    })();
    try {
      return await primaryWorker.runUntil(observedWorkflowResult);
    } catch (error: unknown) {
      // The SDK can report a worker-thread shutdown race after the workflow
      // result has already settled when two workers share a test server. A
      // worker failure before successful workflow completion must propagate.
      if (workflowState.outcome === "fulfilled") {
        return await observedWorkflowResult;
      }
      throw error;
    }
  } finally {
    reportWorker.shutdown();
    await reportRun;
  }
}
