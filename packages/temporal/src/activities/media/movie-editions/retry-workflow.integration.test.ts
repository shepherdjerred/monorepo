import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Worker } from "@temporalio/worker";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { expect, test } from "vitest";
import { createMovieRetryWorkflowFixture } from "@shepherdjerred/media/testing/movie-retry-workflow";
import {
  createMovieNetworkWorkerActivitiesV4,
  createMovieFileWorkerActivitiesV4,
} from "#activities/media/movie-editions.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { verifyMovieHistory } from "#activities/media/testing/replay.ts";
import {
  pinnedMovieRuntimes,
  startMovieWorkflowWorker,
} from "#activities/media/testing/role-worker.ts";

type Scenario = Awaited<ReturnType<typeof createMovieRetryWorkflowFixture>>;

function literalBirth(
  attempt: Awaited<ReturnType<Scenario["evidence"]>>["attempts"][number],
) {
  return {
    operationId: attempt.operationId,
    edition: attempt.edition,
    mediaIds: attempt.mediaIds,
    generations: attempt.generations,
    releaseId: attempt.releaseId,
    recoveryEpoch: attempt.recoveryEpoch,
    sponsorRequestId: attempt.sponsorRequestId,
    movieEditionChoiceId: attempt.movieEditionChoiceId,
    movieEditionChoiceRevision: attempt.movieEditionChoiceRevision,
    movieEditionAuthority: attempt.movieEditionAuthority,
    identityEvidence: attempt.identityEvidence,
  };
}

async function roleActivities(
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

async function closeRoleFixture(input: {
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

test("native failed movie root and child resume through a real same-choice retry and replay all four histories", async () => {
  const { temporal, node } = pinnedMovieRuntimes();
  const directory = await mkdtemp(
    path.join(tmpdir(), "media-movie-retry-role-"),
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
    Awaited<ReturnType<typeof createMovieRetryWorkflowFixture>> | undefined;
  let workflow: Bun.Subprocess | undefined;
  const workers: Worker[] = [];
  const running: Promise<void>[] = [];
  try {
    const descriptions: {
      workflowId: string;
      runId: string;
      status: string;
    }[] = [];
    fixture = await createMovieRetryWorkflowFixture(async (workflowId) => {
      const observed = await environment.client.workflow
        .getHandle(workflowId)
        .describe();
      const description = {
        workflowId,
        runId: observed.runId,
        status: observed.status.name,
      };
      descriptions.push(description);
      return { runId: observed.runId, status: observed.status.name };
    });
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
    await roleActivities(environment, scenario, { workers, running });
    const dispatch = (operationId: string) =>
      scenario.dispatch(async (start) => {
        if (start.input["operationId"] !== operationId)
          throw new Error(
            "Only the actual movie coordinator is dispatched in this retry journey",
          );
        expect(start.workflowType).toBe("reconcileMovieEditionV4Workflow");
        await environment.client.workflow.start(start.workflowType, {
          workflowId: start.workflowId,
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [start.input],
        });
      });
    expect(await dispatch(scenario.input.operationId)).toEqual({
      dispatched: 1,
      deferred: 0,
    });
    const original = environment.client.workflow.getHandle(
      `media-operation-${scenario.input.operationId}`,
    );
    await expect(
      environment.client.connection.withDeadline(Date.now() + 20_000, () =>
        original.result(),
      ),
    ).rejects.toThrow();
    const failed = await scenario.evidence();
    expect(failed.operation).toMatchObject({ status: "reconciling" });
    expect(failed.attempts).toHaveLength(1);
    const attempt = failed.attempts[0];
    if (attempt === undefined)
      throw new Error("Native failed acquisition omitted its actual attempt");
    expect(attempt).toMatchObject({
      state: "downloading",
      filePlan: null,
      torrent: { owned: true },
    });
    expect(failed.assets).toEqual([]);
    expect(failed.adds).toBe(1);
    const childId = `media-acquire-${attempt.id}`;
    const failedChild = environment.client.workflow.getHandle(childId);
    const oldRoot = await original.describe();
    const oldChild = await failedChild.describe();
    expect(oldRoot.status.name).toBe("FAILED");
    expect(oldChild.status.name).toBe("FAILED");
    const histories = [
      { name: "failed-root", history: await original.fetchHistory() },
      { name: "failed-child", history: await failedChild.fetchHistory() },
    ];
    const before = await scenario.authority();
    const birth = literalBirth(attempt);
    scenario.allowTransferObservation();
    const retryId = await scenario.retry();
    expect(retryId).not.toBe(scenario.input.operationId);
    expect(await scenario.authority()).toEqual(before);
    expect(await dispatch(retryId)).toMatchObject({ dispatched: 1 });
    const retried = environment.client.workflow.getHandle(
      `media-operation-${retryId}`,
    );
    expect(
      await environment.client.connection.withDeadline(
        Date.now() + 20_000,
        () => retried.result(),
      ),
    ).toEqual({ status: "completed" });
    const renewed = await scenario.evidence();
    expect(renewed.attempts).toHaveLength(1);
    expect(renewed.attempts[0]).toMatchObject({
      ...birth,
      id: attempt.id,
      coordinatorOperationId: retryId,
      state: "completed",
      torrentId: attempt.torrentId,
      reservations: [],
    });
    expect(renewed.assets).toHaveLength(1);
    expect(renewed.assets[0]).toMatchObject({
      state: "published",
      edition: scenario.input.scope.edition,
      owned: true,
    });
    expect(renewed.binding).toMatchObject({
      edition: scenario.input.scope.edition,
    });
    expect(renewed.adds).toBe(1);
    expect(renewed.torrentCount).toBe(1);
    expect(renewed.seedingOperations).toBe(1);
    const renewal = await scenario.renewal(retryId);
    expect(renewal.receipt).toMatchObject({
      root: {
        workflowId: `media-operation-${scenario.input.operationId}`,
        runId: oldRoot.runId,
        status: "FAILED",
      },
      child: { workflowId: childId, runId: oldChild.runId, status: "FAILED" },
      capture: {
        attemptId: attempt.id,
        previousCoordinatorOperationId: scenario.input.operationId,
        generation: before.target.generation,
      },
      torrent: { id: attempt.torrentId },
    });
    const authority = await scenario.authority();
    expect(authority.target.generation).toBe(before.target.generation);
    expect(authority.requests).toEqual(before.requests);
    expect(authority.choices).toEqual(before.choices);
    expect(descriptions).toContainEqual({
      workflowId: `media-operation-${scenario.input.operationId}`,
      runId: oldRoot.runId,
      status: "FAILED",
    });
    expect(descriptions).toContainEqual({
      workflowId: childId,
      runId: oldChild.runId,
      status: "FAILED",
    });
    const newChild = environment.client.workflow.getHandle(childId);
    const completedChild = await newChild.describe();
    expect(completedChild.status.name).toBe("COMPLETED");
    expect(completedChild.runId).not.toBe(oldChild.runId);
    histories.push(
      { name: "retried-root", history: await retried.fetchHistory() },
      { name: "retried-child", history: await newChild.fetchHistory() },
    );
    for (const entry of histories)
      await verifyMovieHistory(entry.history, {
        node,
        script,
        directory,
        name: entry.name,
        childEnvironment,
      });
  } finally {
    await closeRoleFixture({
      workers,
      running,
      workflow,
      fixture,
      environment,
      directory,
    });
  }
}, 60_000);
