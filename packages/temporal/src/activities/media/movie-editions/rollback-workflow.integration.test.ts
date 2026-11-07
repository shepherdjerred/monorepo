import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Worker } from "@temporalio/worker";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import type { WorkflowHandle } from "@temporalio/client";
import { expect, test } from "vitest";
import { createMovieRollbackRoleFixture } from "@shepherdjerred/media/testing/movie-rollback-role-workflow";
import {
  createMovieNetworkWorkerActivitiesV4,
  createMovieFileWorkerActivitiesV4,
} from "#activities/media/movie-editions.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  pinnedMovieRuntimes,
  startMovieWorkflowWorker,
} from "#activities/media/testing/role-worker.ts";
import { verifyMovieHistory } from "#activities/media/testing/replay.ts";

type Scenario = Awaited<ReturnType<typeof createMovieRollbackRoleFixture>>;

async function movieRollbackRoles(
  environment: TestWorkflowEnvironment,
  scenario: Scenario,
) {
  const network = await Worker.create({
    connection: environment.nativeConnection,
    namespace: "default",
    taskQueue: TASK_QUEUES.MEDIA_NETWORK,
    activities: {
      ...createMovieNetworkWorkerActivitiesV4(() =>
        Promise.resolve({ movie: scenario.movie }),
      ),
      finishMediaOperation: scenario.finishMediaOperation,
    },
  });
  const files = await Worker.create({
    connection: environment.nativeConnection,
    namespace: "default",
    taskQueue: TASK_QUEUES.MEDIA_FILES,
    activities: createMovieFileWorkerActivitiesV4(() =>
      Promise.resolve({ movie: scenario.fileMovie }),
    ),
  });
  const workers = [network, files];
  const running = workers.map((worker) => worker.run());
  return { workers, running };
}

function assertActualRollbackPolls(
  history: Awaited<ReturnType<WorkflowHandle["fetchHistory"]>>,
) {
  const scheduled = (history.events ?? []).flatMap((event) =>
    event.activityTaskScheduledEventAttributes == null
      ? []
      : [event.activityTaskScheduledEventAttributes],
  );
  expect(
    scheduled.filter(
      (event) => event.activityType?.name === "publishMovieWithRollbackV4",
    ),
  ).toHaveLength(30);
  expect(scheduled.map((event) => event.activityType?.name).slice(-4)).toEqual([
    "prepareMovieRollbackV4",
    "rollbackMoviePublicationV4",
    "verifyRolledBackMoviePlexV4",
    "finishMediaOperation",
  ]);
  const timers = (history.events ?? []).flatMap((event) =>
    event.timerStartedEventAttributes == null
      ? []
      : [event.timerStartedEventAttributes],
  );
  expect(timers).toHaveLength(30);
  expect(
    timers.every(
      (timer) => Number(timer.startToFireTimeout?.seconds?.toString()) === 60,
    ),
  ).toBe(true);
}

test("actual root and child wait through thirty Plex observations, restore A with captions, close and replay in separate roles", async () => {
  const { node } = pinnedMovieRuntimes();
  const directory = await mkdtemp(
    path.join(tmpdir(), "media-movie-rollback-role-"),
  );
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  let fixture: Scenario | undefined;
  let workflow: Bun.Subprocess | undefined;
  let roles: Awaited<ReturnType<typeof movieRollbackRoles>> | undefined;
  try {
    fixture = await createMovieRollbackRoleFixture();
    const scenario = fixture;
    const before = await scenario.state();
    const immutable = await scenario.immutable();
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
      namespace: "default",
    });
    roles = await movieRollbackRoles(environment, scenario);
    const root = await environment.client.workflow.start(
      "reconcileMovieEditionV4Workflow",
      {
        workflowId: `media-operation-${scenario.input.operationId}`,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        args: [scenario.rootInput],
      },
    );
    expect(await root.result()).toEqual({
      status: "blocked",
      reason: "movie_plex_publication_unverified",
    });
    const child = environment.client.workflow.getHandle(
      `media-acquire-${scenario.input.attemptId}`,
    );
    const rootClosed = await root.describe();
    const childClosed = await child.describe();
    expect(rootClosed.status.name).toBe("COMPLETED");
    expect(childClosed.status.name).toBe("COMPLETED");
    expect(scenario.results).toHaveLength(30);
    expect(
      scenario.results.every(
        (result) => result.status === "waiting" && result.reason !== null,
      ),
    ).toBe(true);
    const after = await scenario.state();
    expect(after.predecessor).toMatchObject({
      state: "published",
      version: scenario.baseline.version + 2,
      path: scenario.baseline.path,
      checksum: scenario.baseline.checksum,
    });
    expect(after.successor).toMatchObject({ state: "rejected", version: 1 });
    expect(after.bytes).toEqual(before.bytes);
    expect(
      after.predecessor.subtitles
        .filter(
          (row) => row.state === "installed" && row.storageKind === "sidecar",
        )
        .map((row) => row.language)
        .sort(),
    ).toEqual(["en", "zh-Hans"]);
    expect(after.pointer).toMatchObject({
      revision: before.pointer.revision + 2,
    });
    expect(after.pointer.evidenceId).not.toBeNull();
    expect(await scenario.immutable()).toEqual(immutable);
    expect(
      await scenario.db.acquisitionReservation.count({
        where: { attemptId: scenario.input.attemptId },
      }),
    ).toBe(0);
    expect(scenario.wire.additions()).toBe(1);
    const childHistory = await child.fetchHistory();
    assertActualRollbackPolls(childHistory);
    for (const [name, history] of [
      ["root", await root.fetchHistory()],
      ["child", childHistory],
    ] as const)
      await verifyMovieHistory(history, {
        node,
        script,
        directory,
        name,
        childEnvironment,
      });
  } finally {
    try {
      if (roles !== undefined) {
        for (const worker of roles.workers) worker.shutdown();
        await Promise.all(roles.running);
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
}, 90_000);
