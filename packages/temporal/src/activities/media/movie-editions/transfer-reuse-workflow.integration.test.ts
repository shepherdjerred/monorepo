import path from "node:path";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Worker } from "@temporalio/worker";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { historyToJSON } from "@temporalio/common/lib/proto-utils.js";
import { expect, test } from "vitest";
import { createMovieTransferReuseWorkflowFixture } from "@shepherdjerred/media/testing/movie-transfer-reuse-workflow";
import {
  createMovieNetworkWorkerActivitiesV4,
  createMovieFileWorkerActivitiesV4,
} from "#activities/media/movie-editions.ts";
import { createSeedingWorkerActivities } from "#activities/media/seeding.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS } from "#shared/media-activity-budget.ts";
import { verifyMovieHistory } from "#activities/media/testing/replay.ts";
import { assertPrivateHistory } from "#activities/media/testing/history.ts";
import {
  pinnedMovieRuntimes,
  startMovieWorkflowWorker,
} from "#activities/media/testing/role-worker.ts";

type Scenario = Awaited<
  ReturnType<typeof createMovieTransferReuseWorkflowFixture>
>;

function literalOrigin(
  attempt: Awaited<ReturnType<Scenario["sourceState"]>>["origin"],
) {
  const {
    updatedAt: _updatedAt,
    state: _state,
    torrent: _torrent,
    ...birth
  } = attempt;
  return birth;
}

async function startRoles(
  environment: TestWorkflowEnvironment,
  scenario: Scenario,
  roles: { workers: Worker[]; running: Promise<void>[] },
) {
  const network = await Worker.create({
    connection: environment.nativeConnection,
    namespace: "dev",
    taskQueue: TASK_QUEUES.MEDIA_NETWORK,
    activities: {
      ...createMovieNetworkWorkerActivitiesV4(() =>
        Promise.resolve({ movie: scenario.movie }),
      ),
      ...createSeedingWorkerActivities(() =>
        Promise.resolve({ seeding: scenario.seeding }),
      ),
      finishMediaOperation: scenario.finishMediaOperation,
    },
  });
  roles.workers.push(network);
  roles.running.push(network.run());
  const files = await Worker.create({
    connection: environment.nativeConnection,
    namespace: "dev",
    taskQueue: TASK_QUEUES.MEDIA_FILES,
    activities: createMovieFileWorkerActivitiesV4(() =>
      Promise.resolve({ movie: scenario.fileMovie }),
    ),
  });
  roles.workers.push(files);
  roles.running.push(files.run());
}

async function replaySeed(
  history: Parameters<typeof historyToJSON>[0],
  input: {
    node: string;
    script: string;
    directory: string;
    childEnvironment: { PATH: string };
  },
) {
  const scheduled = (history.events ?? []).flatMap((event) =>
    event.activityTaskScheduledEventAttributes == null
      ? []
      : [event.activityTaskScheduledEventAttributes],
  );
  expect(scheduled.map((event) => event.activityType?.name)).toEqual([
    "evaluateMediaSeeding",
    "removeMediaTorrent",
    "finishMediaOperation",
  ]);
  for (const event of scheduled) {
    expect(Number(event.startToCloseTimeout?.seconds?.toString())).toBe(300);
    expect(Number(event.scheduleToCloseTimeout?.seconds?.toString())).toBe(
      HISTORICAL_MEDIA_SCHEDULE_TO_CLOSE_MS / 1000,
    );
    expect(event.taskQueue?.name).toBe(TASK_QUEUES.MEDIA_NETWORK);
    expect(event.retryPolicy?.maximumAttempts).toBe(
      event.activityType?.name === "removeMediaTorrent" ? 1 : 3,
    );
  }
  const serialized = historyToJSON(history);
  assertPrivateHistory(serialized, [
    "magnet:",
    "/downloads/media",
    "/data/movies",
    "encryptedSource",
    "Workflow.Fixture",
  ]);
  const target = path.join(input.directory, "source-seeding.json");
  await Bun.write(target, serialized);
  const replay = Bun.spawn(
    [input.node, "--experimental-strip-types", input.script, "replay", target],
    {
      env: input.childEnvironment,
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

async function closeRoles(input: {
  workers: Worker[];
  running: Promise<void>[];
  workflow: Bun.Subprocess | undefined;
  fixture: Scenario | undefined;
  environment: TestWorkflowEnvironment;
  directory: string;
}) {
  try {
    try {
      for (const worker of input.workers) worker.shutdown();
      await Promise.all(input.running);
    } finally {
      if (input.workflow !== undefined) {
        input.workflow.kill("SIGTERM");
        await input.workflow.exited;
      }
    }
  } finally {
    try {
      await input.fixture?.close();
    } finally {
      await input.environment.teardown();
      await rm(input.directory, { recursive: true, force: true });
    }
  }
}

async function assertReusedMovieBirth(
  scenario: Scenario,
  input: {
    consumed: Awaited<ReturnType<Scenario["consumer"]>>;
    old: Awaited<ReturnType<Scenario["sourceState"]>>;
    selected: Awaited<ReturnType<Scenario["cancelAndSelectNewChoice"]>>;
    rootRunId: string;
    childRunId: string;
    beforeObservation: NonNullable<
      Awaited<
        ReturnType<Scenario["source"]["context"]["qbittorrent"]["observe"]>
      >
    >;
  },
) {
  const { consumed, old, selected, rootRunId, childRunId, beforeObservation } =
    input;
  expect(consumed.attempt.id).not.toBe(old.origin.id);
  expect(consumed.attempt.movieEditionChoiceId).not.toBe(
    old.origin.movieEditionChoiceId,
  );
  expect(consumed.attempt).toMatchObject({
    state: "completed",
    torrentId: old.torrent.id,
  });
  expect(consumed.grant).toMatchObject({
    consumer: {
      attemptId: consumed.attempt.id,
      birthOperationId: selected.operationId,
    },
    origin: {
      attemptId: old.origin.id,
      birthOperationId: old.origin.operationId,
    },
    root: {
      workflowId: `media-operation-${scenario.input.operationId}`,
      runId: rootRunId,
      status: "FAILED",
    },
    child: {
      workflowId: `media-acquire-${old.origin.id}`,
      runId: childRunId,
      status: "FAILED",
    },
  });
  const now = await scenario.sourceState();
  expect(literalOrigin(now.origin)).toEqual(literalOrigin(old.origin));
  expect(now.origin.state).toBe("cancelled");
  const afterObservation = await scenario.source.context.qbittorrent.observe(
    old.torrent.infoHash,
  );
  expect(afterObservation).toMatchObject({
    tags: beforeObservation.tags,
    save_path: beforeObservation.save_path,
    content_path: beforeObservation.content_path,
  });
  return now;
}

function scenarioCommandStarter(
  environment: TestWorkflowEnvironment,
  scenario: Scenario,
) {
  return async (operationId: string) => {
    const command = await scenario.command(operationId);
    const names: Record<string, string> = {
      reconcile_movie_edition_v4: "reconcileMovieEditionV4Workflow",
      acquire_movie_subtitles_v4: "acquireMovieSubtitlesV4Workflow",
      maintain_torrent: "maintainMediaTorrentWorkflow",
    };
    const workflowType = names[command.kind];
    if (workflowType === undefined)
      throw new Error(
        "Native journey received an unrelated actual outbox command",
      );
    return environment.client.workflow.start(workflowType, {
      workflowId: `media-operation-${operationId}`,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      args: [command.payload],
    });
  };
}

test("native closed cancelled movie source is reused by a genuine new birth and removed by its one seed work while every actual history replays", async () => {
  const { temporal, node } = pinnedMovieRuntimes();
  const directory = await mkdtemp(
    path.join(tmpdir(), "media-movie-transfer-reuse-role-"),
  );
  const environment = await TestWorkflowEnvironment.createLocal({
    server: {
      executable: { type: "existing-path", path: temporal },
      ip: "127.0.0.1",
      namespace: "dev",
      ui: false,
    },
  });
  let fixture: Scenario | undefined;
  let workflow: Bun.Subprocess | undefined;
  const workers: Worker[] = [];
  const running: Promise<void>[] = [];
  try {
    const descriptions: {
      workflowId: string;
      runId: string;
      status: string;
    }[] = [];
    fixture = await createMovieTransferReuseWorkflowFixture(
      async (workflowId) => {
        const actual = await environment.client.workflow
          .getHandle(workflowId)
          .describe();
        descriptions.push({
          workflowId,
          runId: actual.runId,
          status: actual.status.name,
        });
        return { runId: actual.runId, status: actual.status.name };
      },
    );
    const scenario = fixture;
    const script = new URL(
      "../../../../scripts/media-system/workflow-worker.ts",
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
    await startRoles(environment, scenario, { workers, running });
    const start = scenarioCommandStarter(environment, scenario);
    const original = await start(scenario.input.operationId);
    await expect(
      environment.client.connection.withDeadline(Date.now() + 20_000, () =>
        original.result(),
      ),
    ).rejects.toThrow();
    const old = await scenario.sourceState();
    expect(old.origin.filePlan).toBeNull();
    const oldChild = environment.client.workflow.getHandle(
      `media-acquire-${old.origin.id}`,
    );
    const rootClosed = await original.describe();
    const childClosed = await oldChild.describe();
    expect(rootClosed.status.name).toBe("FAILED");
    expect(childClosed.status.name).toBe("FAILED");
    scenario.allowTransferObservation();
    const beforeObservation = await scenario.source.context.qbittorrent.observe(
      old.torrent.infoHash,
    );
    if (beforeObservation === null)
      throw new Error("Actual registered original source disappeared");
    const histories = [
      { name: "origin-root", history: await original.fetchHistory() },
      { name: "origin-child", history: await oldChild.fetchHistory() },
    ];
    const selected = await scenario.cancelAndSelectNewChoice();
    expect(selected.operationId).not.toBe(scenario.input.operationId);
    expect(selected.generation).toBeGreaterThan(scenario.input.generation);
    const consumerRoot = await start(selected.operationId);
    expect(
      await environment.client.connection.withDeadline(
        Date.now() + 20_000,
        () => consumerRoot.result(),
      ),
    ).toEqual({ status: "completed" });
    const consumed = await scenario.consumer();
    const now = await assertReusedMovieBirth(scenario, {
      consumed,
      old,
      selected,
      rootRunId: rootClosed.runId,
      childRunId: childClosed.runId,
      beforeObservation,
    });
    const consumerChild = environment.client.workflow.getHandle(
      `media-acquire-${consumed.attempt.id}`,
    );
    const consumerClosed = await consumerChild.describe();
    expect(consumerClosed.status.name).toBe("COMPLETED");
    histories.push(
      { name: "consumer-root", history: await consumerRoot.fetchHistory() },
      { name: "consumer-child", history: await consumerChild.fetchHistory() },
    );
    for (const caption of await scenario.captionCommands()) {
      const handle = await start(caption.id);
      expect(
        await environment.client.connection.withDeadline(
          Date.now() + 20_000,
          () => handle.result(),
        ),
      ).toEqual({ status: "completed" });
      histories.push({
        name: `caption-${String(histories.length)}`,
        history: await handle.fetchHistory(),
      });
    }
    const published = await scenario.consumer();
    const bytes = await Promise.all(
      published.physicalPaths.map(async (filename) => ({
        filename,
        bytes: await readFile(filename),
      })),
    );
    expect(
      new Uint8Array(await readFile(published.sourcePhysicalPath)),
    ).toEqual(scenario.source.bytes);
    scenario.source.wire.control.ratio = 1;
    const seeded = await start(now.seed.operationId);
    expect(
      await environment.client.connection.withDeadline(
        Date.now() + 20_000,
        () => seeded.result(),
      ),
    ).toEqual({ status: "completed" });
    expect(scenario.source.wire.additions()).toBe(1);
    expect(scenario.source.wire.control.deletes).toBe(1);
    expect(await scenario.sourceState()).toMatchObject({
      torrent: { id: old.torrent.id, state: "removed" },
      origin: { id: old.origin.id, state: "cancelled", filePlan: null },
    });
    await expect(readFile(published.sourcePhysicalPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    for (const file of bytes)
      expect(await readFile(file.filename)).toEqual(file.bytes);
    const evidence = await scenario.evidence();
    expect(evidence.torrentCount).toBe(1);
    expect(evidence.seedingOperations).toBe(1);
    expect(evidence.attempts).toHaveLength(2);
    expect(descriptions).toContainEqual({
      workflowId: `media-operation-${scenario.input.operationId}`,
      runId: rootClosed.runId,
      status: "FAILED",
    });
    expect(descriptions).toContainEqual({
      workflowId: `media-acquire-${old.origin.id}`,
      runId: childClosed.runId,
      status: "FAILED",
    });
    for (const entry of histories)
      await verifyMovieHistory(entry.history, {
        node,
        script,
        directory,
        name: entry.name,
        childEnvironment,
      });
    await replaySeed(await seeded.fetchHistory(), {
      node,
      script,
      directory,
      childEnvironment,
    });
  } finally {
    await closeRoles({
      workers,
      running,
      workflow,
      fixture,
      environment,
      directory,
    });
  }
}, 90_000);
