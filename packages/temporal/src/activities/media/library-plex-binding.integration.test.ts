import {
  mediaWorkflowWorkerScript,
  createMovieRoleEnvironment,
  pinnedMovieRuntimes,
  startMovieWorkflowWorker,
  closeMovieRoleFixtureSequential,
} from "./testing/role-worker.ts";
import { replayWorkflowFile } from "#activities/media/testing/process.ts";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

import { Worker } from "@temporalio/worker";
import { Context } from "@temporalio/activity";
import { historyToJSON } from "@temporalio/common/lib/proto-utils.js";
import { assertPrivateHistory } from "./testing/history.ts";
import { expect, test } from "vitest";
import { createLibraryBindingWorkerFixture } from "@shepherdjerred/media/testing/library-binding";
import { createLibraryPlexBindingNetworkActivities } from "./plex-binding.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

/** Bun runs real Activities and files; the credentialless Node process owns Workflow isolates/replay. */
test("initial library outbox reaches the real Network Activity and retains replayable IDs-only history", async () => {
  const { temporal, node } = pinnedMovieRuntimes();
  const directory = await mkdtemp(path.join(tmpdir(), "media-library-worker-"));
  const environment = await createMovieRoleEnvironment(temporal);
  let fixture:
    Awaited<ReturnType<typeof createLibraryBindingWorkerFixture>> | undefined;
  let workflow: Bun.Subprocess | undefined;
  let network: Worker | undefined;
  let running: Promise<void> | undefined;
  try {
    fixture = await createLibraryBindingWorkerFixture();
    const scenario = fixture;
    const script = mediaWorkflowWorkerScript;
    const childEnvironment = { PATH: Bun.env["PATH"] ?? "/usr/bin:/bin" };
    workflow = await startMovieWorkflowWorker({
      node,
      script,
      address: environment.address,
      directory,
      childEnvironment,
    });
    let invocations = 0;
    const activities = createLibraryPlexBindingNetworkActivities(() => {
      invocations++;
      expect(Context.current().info.startToCloseTimeoutMs).toBe(120_000);
      expect(Context.current().info.scheduleToCloseTimeoutMs).toBe(180_000);
      return Promise.resolve(scenario.runtime);
    });
    network = await Worker.create({
      connection: environment.nativeConnection,
      namespace: "dev",
      taskQueue: TASK_QUEUES.MEDIA_NETWORK,
      activities: {
        ...activities,
        finishMediaOperation: scenario.finishMediaOperation,
      },
    });
    running = network.run();
    const dispatched = await scenario.dispatch(async (start) => {
      if (start.input["operationId"] !== scenario.input.operationId)
        throw new Error("Unrelated fixture setup command remains deferred");
      expect(start.workflowType).toBe("verifyLibraryPlexBindingWorkflow");
      expect(start.input).toEqual(scenario.input);
      await environment.client.workflow.start(start.workflowType, {
        workflowId: start.workflowId,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        args: [start.input],
      });
    });
    expect(dispatched.dispatched).toBe(1);
    const handle = environment.client.workflow.getHandle(
      `media-operation-${scenario.input.operationId}`,
    );
    expect(await handle.result()).toEqual({
      status: "verified",
      bindingCount: 1,
    });
    expect(invocations).toBe(1);
    const evidence = await scenario.evidence();
    expect(evidence.operation).toMatchObject({
      status: "completed",
      result: { libraryPlexReceiptV1: { receipt: { input: scenario.input } } },
    });
    expect(evidence.operation.outbox?.dispatchedAt).not.toBeNull();
    expect(evidence.bindings).toHaveLength(1);
    expect(evidence.attempts).toBe(0);
    expect(
      evidence.calls.filter((call) => call === "/library/sections/1/all"),
    ).toHaveLength(2);
    const history = historyToJSON(await handle.fetchHistory());
    assertPrivateHistory(history, ["Synthetic Film", "libraryPlexReceiptV1"]);
    const historyPath = path.join(directory, "history.json");
    await Bun.write(historyPath, history);
    await replayWorkflowFile({
      node: node,
      script: script,
      filename: historyPath,
      childEnvironment: childEnvironment,
    });
  } finally {
    await closeMovieRoleFixtureSequential({
      stopActivities: async () => {
        if (running !== undefined) {
          network?.shutdown();
          await running;
        }
      },
      workflow,
      fixture: fixture,
      environment,
      directory,
    });
  }
}, 60_000);
