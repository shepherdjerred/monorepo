import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { CapacityCycleSchema } from "@shepherdjerred/media/capacity";

const workflowsPath = new URL("../index.ts", import.meta.url).pathname;
test.each(["observed", "disabled", "unavailable", "retry"] as const)(
  "capacity %s uses isolated queues, bounded attempts and replays",
  async (mode) => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const cycle = CapacityCycleSchema.parse({
      recoveryEpoch: 5,
      cycles: [
        { role: "movies", revision: "9" },
        { role: "tv", revision: "9" },
      ],
    });
    let observed = 0;
    let sampled = 0;
    const workflow = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowsPath,
    });
    const network = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.MEDIA_NETWORK,
      activities: {
        observeMediaCapacityMounts: () => {
          observed++;
          return Promise.resolve(
            mode === "disabled" || mode === "unavailable"
              ? { status: mode }
              : { status: "observed", cycle },
          );
        },
      },
    });
    const files = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.MEDIA_FILES,
      activities: {
        sampleMediaCapacity: (input: unknown) => {
          sampled++;
          expect(input).toEqual(cycle);
          if (mode === "retry" && sampled === 1)
            throw new Error("Lost fixture acknowledgment");
          return Promise.resolve({
            status: "completed",
            sampled: 2,
            unavailable: 0,
          });
        },
      },
    });
    const running = [network.run(), files.run()];
    try {
      const handle = await environment.client.workflow.start(
        "observeMediaCapacityWorkflow",
        { workflowId: crypto.randomUUID(), taskQueue: TASK_QUEUES.WORKFLOWS },
      );
      const result = await workflow.runUntil(handle.result());
      expect(observed).toBe(1);
      expect(sampled).toBe(mode === "retry" ? 2 : mode === "observed" ? 1 : 0);
      expect(result).toEqual(
        mode === "disabled" || mode === "unavailable"
          ? { status: mode }
          : { status: "completed", sampled: 2, unavailable: 0 },
      );
      await Worker.runReplayHistory(
        { workflowsPath },
        await handle.fetchHistory(),
      );
    } finally {
      network.shutdown();
      files.shutdown();
      await Promise.all(running);
      await environment.teardown();
    }
  },
  60_000,
);
