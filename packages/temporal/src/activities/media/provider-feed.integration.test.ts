import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { Context } from "@temporalio/activity";
import { historyToJSON } from "@temporalio/common/lib/proto-utils.js";
import { expect, test } from "vitest";
import { createProviderFeedWorkerFixture } from "@shepherdjerred/media/testing/provider-feed";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { assertPrivateHistory } from "./testing/history.ts";

test("native source outbox executes matching on the real Network worker and replays an IDs-only history", async () => {
  const temporal = Bun.which("temporal");
  if (temporal === null) throw new Error("Pinned Temporal CLI required");
  const resolved = Bun.spawnSync(["mise", "which", "node"], {
    stdout: "pipe",
    stderr: "inherit",
  });
  if (resolved.exitCode !== 0) throw new Error("Pinned Node resolution failed");
  const node = resolved.stdout.toString().trim();
  const directory = await mkdtemp(path.join(tmpdir(), "media-feed-worker-"));
  const environment = await TestWorkflowEnvironment.createLocal({
    server: {
      executable: { type: "existing-path", path: temporal },
      ip: "127.0.0.1",
      namespace: "dev",
      ui: false,
    },
  });
  let fixture:
    Awaited<ReturnType<typeof createProviderFeedWorkerFixture>> | undefined;
  let workflow: Bun.Subprocess | undefined;
  let network: Worker | undefined;
  let running: Promise<void> | undefined;
  try {
    fixture = await createProviderFeedWorkerFixture();
    const scenario = fixture;
    const script = new URL(
      "../../../scripts/media-system/workflow-worker.ts",
      import.meta.url,
    ).pathname;
    const marker = path.join(directory, "ready");
    const childEnvironment = { PATH: Bun.env["PATH"] ?? "/usr/bin:/bin" };
    workflow = Bun.spawn(
      [
        node,
        "--experimental-strip-types",
        script,
        "run",
        environment.address.replace(/^localhost:/u, "127.0.0.1:"),
        marker,
      ],
      {
        env: childEnvironment,
        stdin: "ignore",
        stdout: Bun.file(path.join(directory, "workflow.log")),
        stderr: Bun.file(path.join(directory, "workflow-errors.log")),
      },
    );
    const deadline = performance.now() + 30_000;
    while (!(await Bun.file(marker).exists())) {
      if (workflow.exitCode !== null || performance.now() >= deadline)
        throw new Error(`Workflow worker startup failed; inspect ${directory}`);
      await Bun.sleep(100);
    }
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
    const replay = Bun.spawn(
      [node, "--experimental-strip-types", script, "replay", historyPath],
      {
        env: childEnvironment,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exitCode, , error] = await Promise.all([
      replay.exited,
      new Response(replay.stdout).text(),
      new Response(replay.stderr).text(),
    ]);
    expect(exitCode, error).toBe(0);
  } finally {
    try {
      if (running !== undefined) {
        network?.shutdown();
        await running;
      }
      if (workflow !== undefined) {
        workflow.kill("SIGTERM");
        await workflow.exited;
      }
    } finally {
      try {
        await fixture?.close();
      } finally {
        await environment.teardown();
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
}, 60_000);
