import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { Context } from "@temporalio/activity";
import { historyToJSON } from "@temporalio/common/lib/proto-utils.js";
import { expect, test } from "vitest";
import { createLibraryBindingWorkerFixture } from "@shepherdjerred/media/testing/library-binding";
import { createLibraryPlexBindingNetworkActivities } from "./plex-binding.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

/** Bun runs real Activities and files; the credentialless Node process owns Workflow isolates/replay. */
test("initial library outbox reaches the real Network Activity and retains replayable IDs-only history", async () => {
  const temporal = Bun.which("temporal");
  if (temporal === null) throw new Error("Pinned Temporal CLI required");
  const nodeResult = Bun.spawnSync(["mise", "which", "node"], {
    stdout: "pipe",
    stderr: "inherit",
  });
  if (nodeResult.exitCode !== 0)
    throw new Error("Pinned Node resolution failed");
  const node = nodeResult.stdout.toString().trim();
  const directory = await mkdtemp(path.join(tmpdir(), "media-library-worker-"));
  const environment = await TestWorkflowEnvironment.createLocal({
    server: {
      executable: { type: "existing-path", path: temporal },
      ip: "127.0.0.1",
      namespace: "dev",
      ui: false,
    },
  });
  let fixture:
    Awaited<ReturnType<typeof createLibraryBindingWorkerFixture>> | undefined;
  let workflow: Bun.Subprocess | undefined;
  let network: Worker | undefined;
  let running: Promise<void> | undefined;
  try {
    fixture = await createLibraryBindingWorkerFixture();
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
    expect(history).not.toContain("Synthetic Film");
    expect(history).not.toContain("libraryPlexReceiptV1");
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
    const [exitCode, , replayError] = await Promise.all([
      replay.exited,
      new Response(replay.stdout).text(),
      new Response(replay.stderr).text(),
    ]);
    expect(exitCode, replayError).toBe(0);
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
