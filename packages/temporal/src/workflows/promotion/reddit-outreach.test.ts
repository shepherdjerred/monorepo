import { TestWorkflowEnvironment } from "@temporalio/testing";
import { describe, expect, it } from "vitest";
import { runWorkflowWithActivityWorker } from "#workflows/test-support.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

describe("Reddit outreach workflow", () => {
  it("routes preview to the promotion worker and never retries an ambiguous failure", async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    let calls = 0;
    try {
      await expect(
        runWorkflowWithActivityWorker(environment, {
          workflowPath: new URL("reddit-outreach.ts", import.meta.url).pathname,
          activityTaskQueue: TASK_QUEUES.PROMOTION,
          activities: {
            sweepRedditOutreach: (input: unknown) => {
              calls++;
              expect(input).toEqual({ preview: true });
              throw new Error("Unknown reply outcome");
            },
          },
          execute: () =>
            environment.client.workflow.execute("runStormRedditOutreach", {
              workflowId: `reddit-fixture-${crypto.randomUUID()}`,
              taskQueue: TASK_QUEUES.WORKFLOWS,
              args: [{ preview: true }],
            }),
        }),
      ).rejects.toThrow("Workflow execution failed");
      expect(calls).toBe(1);
    } finally {
      await environment.teardown();
    }
  }, 60_000);
});
