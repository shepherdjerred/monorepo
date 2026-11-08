import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { Context } from "@temporalio/activity";
import { expect, test } from "vitest";
import {
  ReverifyPlexBindingInputSchema,
  ReverifyPlexBindingResultSchema,
  PLEX_BINDING_RESULT_MAX_BYTES,
} from "@shepherdjerred/media/plex-binding";
import { createPlexBindingNetworkActivities } from "#activities/media/plex-binding.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const workflowsPath = new URL("../index.ts", import.meta.url).pathname;
const input = ReverifyPlexBindingInputSchema.parse({
  schemaVersion: 1,
  kind: "reverify_plex_binding",
  operationId: "00000000-0000-4000-8000-000000000001",
  recoveryEpoch: 2,
  assetIds: ["00000000-0000-4000-8000-000000000002"],
});

/** Synthetic maximum result exercises the actual SDK wire; real PG counts are tested separately. */
test.each(["verified", "superseded", "protected", "retry", "failure"] as const)(
  "Plex binding %s uses the IDs/count wire and retained-history replay",
  async (mode) => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    let calls = 0;
    const finished: unknown[] = [];
    const result = ReverifyPlexBindingResultSchema.parse(
      mode === "superseded"
        ? { status: mode }
        : mode === "protected"
          ? { status: mode, reason: "ambiguous_item" }
          : { status: "verified", bindingCount: 10_000 },
    );
    let network: Worker | undefined;
    let running: Promise<void> | undefined;
    try {
      const workflow = await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        workflowsPath,
      });
      const activities = createPlexBindingNetworkActivities(() =>
        Promise.resolve({
          plexBinding: {
            reverify: (raw, execution) => {
              expect(raw).toEqual(input);
              execution.assertActive();
              expect(Context.current().info.startToCloseTimeoutMs).toBe(
                120_000,
              );
              expect(Context.current().info.scheduleToCloseTimeoutMs).toBe(
                180_000,
              );
              calls++;
              if (mode === "failure" || (mode === "retry" && calls === 1)) {
                throw new Error(
                  "https://private.invalid/PLEX_BINDING_SECRET_CANARY",
                );
              }
              return Promise.resolve(result);
            },
          },
        }),
      );
      network = await Worker.create({
        connection: environment.nativeConnection,
        taskQueue: TASK_QUEUES.MEDIA_NETWORK,
        activities: {
          ...activities,
          finishMediaOperation: (value: unknown) => {
            finished.push(value);
            return Promise.resolve();
          },
        },
      });
      running = network.run();
      const handle = await environment.client.workflow.start(
        "reverifyPlexBindingWorkflow",
        {
          workflowId: crypto.randomUUID(),
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [input],
        },
      );
      const completed = workflow.runUntil(handle.result());
      if (mode === "failure") {
        await expect(completed).rejects.toThrow();
        expect(finished).toEqual([]);
      } else {
        expect(await completed).toEqual(result);
        expect(
          new TextEncoder().encode(JSON.stringify(result)).byteLength,
        ).toBeLessThanOrEqual(PLEX_BINDING_RESULT_MAX_BYTES);
        expect(finished).toEqual([
          {
            operationId: input.operationId,
            status: "completed",
            reason:
              result.status === "verified"
                ? null
                : result.status === "superseded"
                  ? "superseded"
                  : result.reason,
          },
        ]);
      }
      expect(calls).toBe(mode === "retry" || mode === "failure" ? 2 : 1);
      const history = await handle.fetchHistory();
      const encoded = JSON.stringify(history);
      expect(encoded).not.toContain("PLEX_BINDING_SECRET_CANARY");
      expect(encoded).not.toContain("private.invalid");
      await Worker.runReplayHistory({ workflowsPath }, history);
    } finally {
      try {
        if (running !== undefined) {
          network?.shutdown();
          await running;
        }
      } finally {
        await environment.teardown();
      }
    }
  },
  60_000,
);
