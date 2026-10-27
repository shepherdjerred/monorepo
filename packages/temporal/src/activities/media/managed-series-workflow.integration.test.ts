import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Worker } from "@temporalio/worker";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { historyToJSON } from "@temporalio/common/lib/proto-utils.js";
import { expect, test } from "vitest";
import { createManagedSeriesWorkflowFixture } from "@shepherdjerred/media/testing/managed-series-workflow";
import {
  createAcquisitionNetworkWorkerActivities,
  createAcquisitionFileWorkerActivities,
} from "./acquisition.ts";
import { createPlexPublicationActivities } from "./plex-publication.ts";
import { createPlexBoundConsumerActivities } from "./plex-consumers.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  pinnedMovieRuntimes,
  startMovieWorkflowWorker,
} from "./testing/role-worker.ts";
import { assertPrivateHistory } from "./testing/history.ts";

test("real role workers upgrade both adopted episodes through the recurring outbox and replay without personal requests", async () => {
  const { temporal, node } = pinnedMovieRuntimes();
  const directory = await mkdtemp(
    path.join(tmpdir(), "media-managed-series-role-"),
  );
  const environment = await TestWorkflowEnvironment.createLocal({
    server: {
      executable: { type: "existing-path", path: temporal },
      ip: "127.0.0.1",
      namespace: "dev",
      ui: false,
    },
  });
  let fixture:
    Awaited<ReturnType<typeof createManagedSeriesWorkflowFixture>> | undefined;
  let workflow: Bun.Subprocess | undefined;
  const workers: Worker[] = [];
  const running: Promise<void>[] = [];
  try {
    fixture = await createManagedSeriesWorkflowFixture();
    const scenario = fixture;
    const initial = await scenario.evidence();
    expect(initial.attempts).toEqual([]);
    expect(initial.personalRequests).toBe(0);
    expect(initial.operations).toHaveLength(2);
    const script = new URL(
      "../../../scripts/media-system/workflow-worker.ts",
      import.meta.url,
    ).pathname;
    const childEnvironment = { PATH: Bun.env["PATH"] ?? "/usr/bin:/bin" };
    workflow = await startMovieWorkflowWorker({
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
        ...createAcquisitionNetworkWorkerActivities(() =>
          Promise.resolve({ acquisition: scenario.acquisition }),
        ),
        ...createPlexPublicationActivities(() => Promise.resolve(scenario)),
        ...createPlexBoundConsumerActivities(() => Promise.resolve(scenario)),
        finishMediaOperation: scenario.finishMediaOperation,
      },
    });
    workers.push(network);
    running.push(network.run());
    const files = await Worker.create({
      connection: environment.nativeConnection,
      namespace: "dev",
      taskQueue: TASK_QUEUES.MEDIA_FILES,
      activities: createAcquisitionFileWorkerActivities(() =>
        Promise.resolve({ acquisition: scenario.fileAcquisition }),
      ),
    });
    workers.push(files);
    running.push(files.run());
    const started: string[] = [];
    const dispatched = await scenario.dispatch(async (start) => {
      if (
        !initial.operations.some(
          (operation) => operation.id === start.input["operationId"],
        )
      )
        throw new Error("Other adoption and independent commands stay queued");
      expect(start.workflowType).toBe("reconcileMediaWorkflow");
      await environment.client.workflow.start(start.workflowType, {
        workflowId: start.workflowId,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        args: [start.input],
      });
      started.push(start.workflowId);
    });
    expect(dispatched.dispatched).toBe(2);
    const results = await environment.client.connection.withDeadline(
      Date.now() + 20_000,
      () =>
        Promise.all(
          started.map((id) =>
            environment.client.workflow.getHandle(id).result(),
          ),
        ),
    );
    expect(results).toContainEqual({ status: "completed" });
    const evidence = await scenario.evidence();
    expect(evidence.personalRequests).toBe(0);
    expect(evidence.attempts).toHaveLength(1);
    const attempt = evidence.attempts[0];
    if (attempt === undefined)
      throw new Error("Actual shared episode upgrade missing");
    expect(attempt).toMatchObject({
      state: "completed",
      sponsorRequestId: null,
      identityEvidence: {
        schemaVersion: 4,
        management: { receiptId: scenario.receiptId },
      },
      reservations: [],
      torrent: { owned: true },
    });
    expect([...attempt.mediaIds].sort()).toEqual([...scenario.mediaIds].sort());
    expect(evidence.assets).toHaveLength(2);
    expect(evidence.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: scenario.originalAssetId,
          state: "superseded",
        }),
        expect.objectContaining({ state: "published" }),
      ]),
    );
    expect(evidence.bindings).toHaveLength(2);
    for (const binding of evidence.bindings)
      expect(binding.revision).toBe(
        (initial.bindings.find((row) => row.mediaId === binding.mediaId)
          ?.revision ?? -1) + 1,
      );
    expect(evidence.adds).toBe(1);
    for (const id of [...started, `media-acquire-${attempt.id}`]) {
      const history = await environment.client.workflow
        .getHandle(id)
        .fetchHistory();
      const serialized = historyToJSON(history);
      assertPrivateHistory(serialized, [
        "magnet:",
        "Synthetic.Anime",
        "synthetic-series:",
        "library_series_management",
        "profileVersionAtCapture",
        "selectionHash",
        "encryptedSource",
        "/data/tv",
        "/downloads/media",
      ]);
      const target = path.join(directory, `${id}.json`);
      await Bun.write(target, serialized);
      const replay = Bun.spawn(
        [node, "--experimental-strip-types", script, "replay", target],
        {
          env: childEnvironment,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [code, , error] = await Promise.all([
        replay.exited,
        new Response(replay.stdout).text(),
        new Response(replay.stderr).text(),
      ]);
      expect(code, error).toBe(0);
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
}, 60_000);
