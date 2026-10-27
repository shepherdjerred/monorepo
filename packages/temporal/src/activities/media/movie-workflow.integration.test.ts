import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Worker } from "@temporalio/worker";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { expect, test } from "vitest";
import { createMovieWorkflowFixture } from "@shepherdjerred/media/testing/movie-workflow";
import {
  createMovieNetworkWorkerActivitiesV4,
  createMovieFileWorkerActivitiesV4,
} from "./movie-editions.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { verifyMovieHistory } from "./testing/replay.ts";

async function startWorkflowWorker(options: {
  node: string;
  script: string;
  address: string;
  directory: string;
  childEnvironment: { PATH: string };
}) {
  const marker = path.join(options.directory, "ready");
  const workflow = Bun.spawn(
    [
      options.node,
      "--experimental-strip-types",
      options.script,
      "run",
      options.address.replace(/^localhost:/u, "127.0.0.1:"),
      marker,
    ],
    {
      env: options.childEnvironment,
      stdin: "ignore",
      stdout: Bun.file(path.join(options.directory, "workflow.log")),
      stderr: Bun.file(path.join(options.directory, "workflow-errors.log")),
    },
  );
  try {
    const deadline = performance.now() + 30_000;
    while (!(await Bun.file(marker).exists())) {
      if (workflow.exitCode !== null || performance.now() >= deadline)
        throw new Error(
          `Workflow worker startup failed; inspect ${options.directory}`,
        );
      await Bun.sleep(100);
    }
    return workflow;
  } catch (error) {
    workflow.kill("SIGTERM");
    await workflow.exited;
    throw error;
  }
}

test.each([
  "default",
  "theatrical_cut",
  "directors_cut",
  "extended_cut",
  "final_cut",
  "unrated_cut",
  "uncut_version",
] as const)(
  "real role workers execute and replay a %s acquisition from the consent outbox through Plex completion",
  async (edition) => {
    const temporal = Bun.which("temporal");
    if (temporal === null) throw new Error("Pinned Temporal CLI required");
    const resolved = Bun.spawnSync(["mise", "which", "node"], {
      stdout: "pipe",
      stderr: "inherit",
    });
    if (resolved.exitCode !== 0) throw new Error("Pinned Node required");
    const node = resolved.stdout.toString().trim();
    const directory = await mkdtemp(path.join(tmpdir(), "media-movie-role-"));
    const environment = await TestWorkflowEnvironment.createLocal({
      server: {
        executable: { type: "existing-path", path: temporal },
        ip: "127.0.0.1",
        namespace: "dev",
        ui: false,
      },
    });
    let fixture:
      Awaited<ReturnType<typeof createMovieWorkflowFixture>> | undefined;
    let workflow: Bun.Subprocess | undefined;
    const workers: Worker[] = [];
    const running: Promise<void>[] = [];
    try {
      fixture = await createMovieWorkflowFixture(edition, {
        missingEnglish: true,
      });
      const scenario = fixture;
      const initial = await scenario.evidence();
      expect(initial.attempts).toEqual([]);
      const script = new URL(
        "../../../scripts/media-system/workflow-worker.ts",
        import.meta.url,
      ).pathname;
      const childEnvironment = { PATH: Bun.env["PATH"] ?? "/usr/bin:/bin" };
      workflow = await startWorkflowWorker({
        node,
        script,
        address: environment.address,
        directory,
        childEnvironment,
      });
      const network = await Worker.create({
        connection: environment.nativeConnection,
        namespace: "dev",
        taskQueue: TASK_QUEUES.MEDIA_NETWORK,
        activities: {
          ...createMovieNetworkWorkerActivitiesV4(() =>
            Promise.resolve({ movie: scenario.movie }),
          ),
          finishMediaOperation: scenario.finishMediaOperation,
        },
      });
      workers.push(network);
      running.push(network.run());
      const files = await Worker.create({
        connection: environment.nativeConnection,
        namespace: "dev",
        taskQueue: TASK_QUEUES.MEDIA_FILES,
        activities: createMovieFileWorkerActivitiesV4(() =>
          Promise.resolve({ movie: scenario.fileMovie }),
        ),
      });
      workers.push(files);
      running.push(files.run());
      const dispatched = await scenario.dispatch(async (start) => {
        if (start.input["operationId"] !== scenario.input.operationId)
          throw new Error(
            "Only the actual request coordinator is dispatched in this fixture",
          );
        expect(start.workflowType).toBe("reconcileMovieEditionV4Workflow");
        await environment.client.workflow.start(start.workflowType, {
          workflowId: start.workflowId,
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [start.input],
        });
      });
      expect(dispatched).toEqual({ dispatched: 1, deferred: 0 });
      const parent = environment.client.workflow.getHandle(
        `media-operation-${scenario.input.operationId}`,
      );
      expect(
        await environment.client.connection.withDeadline(
          Date.now() + 20_000,
          () => parent.result(),
        ),
      ).toEqual({ status: "completed" });
      const evidence = await scenario.evidence();
      expect(evidence.operation).toMatchObject({ status: "completed" });
      expect(evidence.attempts).toHaveLength(1);
      const attempt = evidence.attempts[0];
      if (attempt === undefined)
        throw new Error("Actual acquisition attempt missing");
      expect(attempt).toMatchObject({
        edition,
        state: "completed",
        reservations: [],
        torrent: { owned: true },
      });
      expect(evidence.assets).toHaveLength(1);
      expect(evidence.assets[0]).toMatchObject({ edition, state: "published" });
      expect(evidence.binding).toMatchObject({ edition });
      expect(evidence.adds).toBe(1);
      const captionCommands = await scenario.captionOperations();
      expect(captionCommands).toHaveLength(2);
      expect(captionCommands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            payload: expect.objectContaining({ language: "en" }),
          }),
          expect.objectContaining({
            payload: expect.objectContaining({ language: "zh-Hans" }),
          }),
        ]),
      );
      const captionIds = new Set(captionCommands.map((command) => command.id));
      const captionDispatch = await scenario.dispatch(async (start) => {
        const operationId = start.input["operationId"];
        if (typeof operationId !== "string" || !captionIds.has(operationId))
          throw new Error(
            "Seeding remains independently queued in this caption fixture",
          );
        expect(start.workflowType).toBe("acquireMovieSubtitlesV4Workflow");
        await environment.client.workflow.start(start.workflowType, {
          workflowId: start.workflowId,
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [start.input],
        });
      });
      expect(captionDispatch.dispatched).toBe(2);
      const captions = captionCommands.map((command) =>
        environment.client.workflow.getHandle(`media-operation-${command.id}`),
      );
      const captionResults = await environment.client.connection.withDeadline(
        Date.now() + 20_000,
        () => Promise.all(captions.map((handle) => handle.result())),
      );
      expect(captionResults).toEqual([
        { status: "completed" },
        { status: "completed" },
      ]);
      const afterCaptions = await scenario.evidence();
      const beforeAsset = evidence.assets[0];
      const afterAsset = afterCaptions.assets[0];
      if (beforeAsset === undefined || afterAsset === undefined)
        throw new Error(
          "Actual serving video disappeared during caption installation",
        );
      expect(afterAsset.version).toBe(beforeAsset.version);
      expect(afterAsset.checksum).toBe(beforeAsset.checksum);
      expect(afterAsset.subtitles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ language: "en", state: "installed" }),
          expect.objectContaining({ language: "zh-Hans", state: "installed" }),
        ]),
      );
      for (const [name, handle] of [
        ["parent", parent],
        [
          "child",
          environment.client.workflow.getHandle(`media-acquire-${attempt.id}`),
        ],
        ...captions.map(
          (captionHandle, index) =>
            [`captions-${String(index)}`, captionHandle] as const,
        ),
      ] as const) {
        await verifyMovieHistory(await handle.fetchHistory(), {
          node,
          script,
          directory,
          name,
          childEnvironment,
        });
      }
    } finally {
      try {
        try {
          for (const worker of workers) worker.shutdown();
          await Promise.all(running);
        } finally {
          if (workflow !== undefined) {
            workflow.kill("SIGTERM");
            await workflow.exited;
          }
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
  },
  60_000,
);
