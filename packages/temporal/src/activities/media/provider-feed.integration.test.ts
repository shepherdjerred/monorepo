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
import { expect, test } from "vitest";
import { createProviderFeedWorkerFixture } from "@shepherdjerred/media/testing/provider-feed";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { assertPrivateHistory } from "./testing/history.ts";

test("native source outbox executes matching on the real Network worker and replays an IDs-only history", async () => {
  const { temporal, node } = pinnedMovieRuntimes();
  const directory = await mkdtemp(path.join(tmpdir(), "media-feed-worker-"));
  const environment = await createMovieRoleEnvironment(temporal);
  let fixture:
    Awaited<ReturnType<typeof createProviderFeedWorkerFixture>> | undefined;
  let workflow: Bun.Subprocess | undefined;
  let network: Worker | undefined;
  let running: Promise<void> | undefined;
  try {
    fixture = await createProviderFeedWorkerFixture();
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
    network = await Worker.create({
      connection: environment.nativeConnection,
      namespace: "dev",
      taskQueue: TASK_QUEUES.MEDIA_NETWORK,
      activities: {
        matchProviderFeedSource: (input: typeof scenario.input) => {
          expect(Context.current().info.startToCloseTimeoutMs).toBe(120_000);
          expect(Context.current().info.scheduleToCloseTimeoutMs).toBe(180_000);
          return scenario.matchProviderFeedSource(input);
        },
        finishMediaOperation: scenario.finishMediaOperation,
      },
    });
    running = network.run();
    const dispatched = await scenario.dispatch(async (start) => {
      if (start.input["operationId"] !== scenario.input.operationId)
        throw new Error("Unrelated fixture setup remains deferred");
      expect(start.workflowType).toBe("matchProviderFeedSourceWorkflow");
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
    await handle.result();
    const evidence = await scenario.evidence();
    expect(evidence.operation).toMatchObject({
      status: "completed",
      result: {
        feedMatchV1: { sourceId: scenario.input.sourceId, completed: true },
      },
    });
    expect(evidence.operation.outbox?.dispatchedAt).not.toBeNull();
    expect(evidence.queued).toHaveLength(1);
    expect(evidence.queued[0]?.outbox).toMatchObject({
      kind: "reconcile_media",
      dispatchedAt: null,
    });
    expect(evidence.attempts).toBe(0);
    expect(evidence.torrents).toBe(0);
    const history = historyToJSON(await handle.fetchHistory());
    assertPrivateHistory(history, [
      "Feed.Fixture",
      "magnet:",
      "encryptedSource",
      "sourceHash",
    ]);
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
