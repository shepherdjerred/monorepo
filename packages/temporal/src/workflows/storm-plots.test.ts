import { describe, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { runStormPlotReconciliationWorkflow } from "./homelab/storm-plots.ts";
import { runWorkflowWithActivityWorker } from "./test-support.ts";

describe("shop reconciliation workflow", () => {
  test("routes finite recovery to the isolated worker using its run id", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    let operation: string | undefined;
    try {
      await runWorkflowWithActivityWorker(environment, {
        activityTaskQueue: TASK_QUEUES.MINING_RESET,
        workflowPath: new URL("index.ts", import.meta.url).pathname,
        activities: {
          reconcileStormPlots: async (id: string) => {
            operation = id;
            return "completed" as const;
          },
        },
        execute: () =>
          environment.client.workflow.execute(
            runStormPlotReconciliationWorkflow,
            {
              args: [],
              taskQueue: TASK_QUEUES.WORKFLOWS,
              workflowId: `test-storm-plots-${crypto.randomUUID()}`,
            },
          ),
      });
      expect(operation).toMatch(/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/u);
    } finally {
      await environment.teardown();
    }
  }, 60_000);
});
