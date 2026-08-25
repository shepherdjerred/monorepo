import { describe, expect, test, vi } from "vitest";
import type { Client } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { handleIosAction } from "./triggers.ts";

type WorkflowStart = (
  workflowType: string,
  options: { taskQueue: string; workflowId: string },
) => Promise<unknown>;

function fakeClient(start: WorkflowStart): Client {
  const client = Object.create(null);
  client.workflow = { start };
  return client;
}

describe("Home Assistant event routing", () => {
  test("starts iOS good-night actions on the home queue", async () => {
    const start = vi.fn<WorkflowStart>(() => Promise.resolve());
    await handleIosAction(fakeClient(start))({
      data: { actionID: "A91A15AA-479E-416C-8F51-BD983A999266" },
    });

    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]?.[0]).toBe("goodNight");
    expect(start.mock.calls[0]?.[1]).toMatchObject({
      taskQueue: TASK_QUEUES.HOME,
    });
  });
});
