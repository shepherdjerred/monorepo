import { Worker } from "@temporalio/worker";
import type { TestWorkflowEnvironment } from "@temporalio/testing";

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
    try {
      return await primaryWorker.runUntil(workflowResult);
    } catch {
      // The SDK can report a worker-thread shutdown race after the workflow
      // result has already settled when two workers share a test server.
      return await workflowResult;
    }
  } finally {
    reportWorker.shutdown();
    await reportRun;
  }
}
