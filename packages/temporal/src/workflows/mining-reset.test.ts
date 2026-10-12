import { describe, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { runMiningWorldResetWorkflow } from "./homelab/mining-reset.ts";
import { runWorkflowWithActivityWorker } from "./test-support.ts";

describe("quarterly mining reset workflow", () => {
  test("waits on durable Workflow timers until the server hibernates", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    let attempts = 0;
    const announced: string[] = [];
    try {
      const infraWorker = await Worker.create({
        connection: environment.nativeConnection,
        namespace: "default",
        taskQueue: TASK_QUEUES.INFRA,
        activities: {
          announceStormMiningResetDone: async (period: string) => {
            announced.push(period);
          },
        },
      });
      await runWorkflowWithActivityWorker(environment, {
        activityTaskQueue: TASK_QUEUES.MINING_RESET,
        workflowPath: new URL("index.ts", import.meta.url).pathname,
        activities: {
          resetMiningWorld: async () => {
            attempts += 1;
            return attempts < 3
              ? { kind: "deferred" as const }
              : {
                  kind: "completed" as const,
                  message: "mining reset complete",
                };
          },
        },
        execute: () =>
          infraWorker.runUntil(
            environment.client.workflow.execute(runMiningWorldResetWorkflow, {
              args: [],
              taskQueue: TASK_QUEUES.WORKFLOWS,
              workflowId: `test-mining-reset-${crypto.randomUUID()}`,
            }),
          ),
      });
      expect(attempts).toBe(3);
      expect(announced).toHaveLength(1);
      expect(announced[0]).toMatch(/^\d{4}q[1-4]$/);
    } finally {
      await environment.teardown();
    }
  }, 60_000);
});
