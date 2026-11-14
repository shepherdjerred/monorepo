import { NativeConnection } from "@temporalio/worker";
import { expect, it, vi } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { createQueueWorker } from "#worker-factory";

const { create } = vi.hoisted(() => ({
  create: vi.fn(async (options: unknown) => options),
}));
vi.mock("@temporalio/worker", () => ({
  Worker: { create },
  NativeConnection: { connect: async () => ({}) },
}));

it("gives both promotion Activity queues the existing 17-minute deadline, preserving other defaults", async () => {
  const options = {
    connection: await NativeConnection.connect(),
    workflowsPath: "/unused",
    workflowUiInterceptorPath: "/unused",
    domainTaggingInterceptorPath: "/unused",
    bootstrap: { namespace: "dev" as const, workerDeployment: undefined },
    temporalTracing: undefined,
  };
  for (const taskQueue of [
    TASK_QUEUES.PROMOTION,
    TASK_QUEUES.PROMOTION_CONTROL,
  ]) {
    await createQueueWorker(
      { kind: "activity", role: "promotion", taskQueue, activities: {} },
      options,
      "dev",
    );
    expect(create).toHaveBeenLastCalledWith(
      expect.objectContaining({ taskQueue, shutdownGraceTime: 17 * 60_000 }),
    );
  }
  await createQueueWorker(
    {
      kind: "activity",
      role: "reports",
      taskQueue: TASK_QUEUES.REPORTS,
      activities: {},
    },
    options,
    "dev",
  );
  expect(create.mock.calls.at(-1)?.[0]).not.toHaveProperty("shutdownGraceTime");
  await createQueueWorker(
    { kind: "workflow", role: "workflows", taskQueue: TASK_QUEUES.WORKFLOWS },
    options,
    "dev",
  );
  expect(create.mock.calls.at(-1)?.[0]).not.toHaveProperty("shutdownGraceTime");
});
