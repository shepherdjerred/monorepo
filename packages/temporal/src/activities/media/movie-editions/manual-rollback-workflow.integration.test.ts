import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Worker } from "@temporalio/worker";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import type { WorkflowHandle } from "@temporalio/client";
import { expect, test } from "vitest";
import { createManualMovieRollbackRoleFixture } from "@shepherdjerred/media/testing/movie-manual-rollback-role-workflow";
import {
  createRequestedMovieRollbackFileWorkerActivitiesV1,
  createRequestedMovieRollbackNetworkWorkerActivitiesV1,
} from "#activities/media/movie-editions/manual-rollback.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  pinnedMovieRuntimes,
  startMovieWorkflowWorker,
} from "#activities/media/testing/role-worker.ts";
import { verifyMovieHistory } from "#activities/media/testing/replay.ts";

type Scenario = Awaited<
  ReturnType<typeof createManualMovieRollbackRoleFixture>
>;

async function manualRoles(
  environment: TestWorkflowEnvironment,
  scenario: Scenario,
) {
  const network = await Worker.create({
    connection: environment.nativeConnection,
    namespace: "default",
    taskQueue: TASK_QUEUES.MEDIA_NETWORK,
    activities: {
      ...createRequestedMovieRollbackNetworkWorkerActivitiesV1(() =>
        Promise.resolve({ movie: scenario.movie }),
      ),
      finishMediaOperation: scenario.finishMediaOperation,
    },
  });
  const files = await Worker.create({
    connection: environment.nativeConnection,
    namespace: "default",
    taskQueue: TASK_QUEUES.MEDIA_FILES,
    activities: createRequestedMovieRollbackFileWorkerActivitiesV1(() =>
      Promise.resolve({ movie: scenario.fileMovie }),
    ),
  });
  const workers = [network, files];
  return { workers, running: workers.map((worker) => worker.run()) };
}

function assertManualActivityOrder(
  history: Awaited<ReturnType<WorkflowHandle["fetchHistory"]>>,
) {
  const activities = (history.events ?? []).flatMap((event) =>
    event.activityTaskScheduledEventAttributes == null
      ? []
      : [event.activityTaskScheduledEventAttributes.activityType?.name],
  );
  expect(activities).toEqual([
    "observeRequestedMovieRollbackV1",
    "prepareRequestedMovieRollbackV1",
    "observeRequestedMovieRollbackV1",
    "rollbackRequestedMoviePublicationV1",
    "verifyRequestedMovieRollbackV1",
    "finishMediaOperation",
  ]);
}

async function assertManualClosure(
  scenario: Scenario,
  before: Awaited<ReturnType<Scenario["state"]>>,
  runId: string,
) {
  const after = await scenario.state();
  const a = after.assets.find((asset) => asset.id === scenario.asset.id);
  const b = after.assets.find(
    (asset) => asset.id === scenario.plan.entries[0].assetId,
  );
  expect(a).toMatchObject({
    state: "published",
    version: scenario.baseline.version + 2,
    path: scenario.baseline.path,
    checksum: scenario.baseline.checksum,
  });
  expect(b).toMatchObject({ state: "rejected", version: 1 });
  expect(
    a?.subtitles
      .filter(
        (caption) =>
          caption.state === "installed" && caption.storageKind === "sidecar",
      )
      .map((caption) => caption.language)
      .sort(),
  ).toEqual(["en", "zh-Hans"]);
  expect(
    b?.subtitles.filter(
      (caption) =>
        caption.state === "quarantined" && caption.storageKind === "sidecar",
    ),
  ).toHaveLength(2);
  expect(after.cleanup).toEqual({
    ...before.cleanup,
    state: "cancelled",
    version: before.cleanup.version + 1,
  });
  expect(after.pointer).toMatchObject({
    revision: before.pointer.revision + 2,
  });
  expect(after.files).toHaveLength(before.files.length);
  for (const original of before.files) {
    const current = after.files.find(
      (file) =>
        file.assetId === original.assetId &&
        file.subtitleId === original.subtitleId,
    );
    expect(current).toMatchObject({
      device: original.device,
      inode: original.inode,
      bytes: original.bytes,
    });
  }
  const receipts = await scenario.receipts();
  expect(receipts.movieRollbackIntentV1?.intent).toMatchObject({
    invocation: {
      mode: "manual_verified",
      command: scenario.input,
      source: scenario.sourceInput,
    },
    owner: {
      workflowId: `media-operation-${scenario.input.operationId}`,
      runId,
    },
  });
  expect(
    receipts.movieRollbackIntentV1?.intent.captionManifest?.captions,
  ).toHaveLength(2);
  expect(receipts.movieRollbackPhysicalV1).toBeDefined();
  expect(receipts.movieRollbackPlexV1).toBeDefined();
}

test("actual independent owner outbox dispatch runs manual caption inverse through separate SDK roles, finishes and replays", async () => {
  const { node } = pinnedMovieRuntimes();
  const directory = await mkdtemp(
    path.join(tmpdir(), "media-manual-rollback-role-"),
  );
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  let fixture: Scenario | undefined;
  let workflow: Bun.Subprocess | undefined;
  let roles: Awaited<ReturnType<typeof manualRoles>> | undefined;
  try {
    fixture = await createManualMovieRollbackRoleFixture();
    const scenario = fixture;
    const before = await scenario.state();
    const immutable = await scenario.immutable();
    const commandBefore = await scenario.command();
    expect(commandBefore.status).toBe("queued");
    expect(commandBefore.userId).toBe(scenario.owner.id);
    expect(commandBefore.userId).not.toBe(scenario.network.actor.id);
    expect(commandBefore.outbox?.dispatchedAt).toBeNull();
    expect(commandBefore.outbox?.payload).toEqual(commandBefore.payload);
    const script = new URL(
      "../../../../scripts/media-system/workflow-worker.ts",
      import.meta.url,
    ).pathname;
    const runtimePath = Bun.env["PATH"];
    if (runtimePath === undefined || runtimePath.length === 0)
      throw new Error("Pinned runtime PATH required");
    const childEnvironment = { PATH: runtimePath };
    workflow = await startMovieWorkflowWorker({
      node,
      script,
      address: environment.address,
      directory,
      childEnvironment,
      namespace: "default",
    });
    roles = await manualRoles(environment, scenario);
    const starts: { workflowId: string; input: unknown }[] = [];
    const dispatched = await scenario.dispatch(async (start) => {
      if (start.workflowId !== `media-operation-${scenario.input.operationId}`)
        throw new Error(
          "Unrelated real queued commands remain for their own workers",
        );
      expect(start.workflowType).toBe("rollbackMovieEditionV1Workflow");
      expect(start.input).toEqual(scenario.input);
      await environment.client.workflow.start(start.workflowType, {
        workflowId: start.workflowId,
        taskQueue: TASK_QUEUES.WORKFLOWS,
        args: [start.input],
      });
      starts.push({ workflowId: start.workflowId, input: start.input });
    });
    expect(dispatched.dispatched).toBe(1);
    expect(starts).toEqual([
      {
        workflowId: `media-operation-${scenario.input.operationId}`,
        input: scenario.input,
      },
    ]);
    const root = environment.client.workflow.getHandle(
      `media-operation-${scenario.input.operationId}`,
    );
    expect(await root.result()).toEqual({ status: "completed" });
    const closed = await root.describe();
    expect(closed.status.name).toBe("COMPLETED");
    await assertManualClosure(scenario, before, closed.runId);
    const commandAfter = await scenario.command();
    expect(commandAfter).toMatchObject({
      status: "completed",
      payload: commandBefore.payload,
      userId: commandBefore.userId,
      createdAt: commandBefore.createdAt,
    });
    expect(commandAfter.outbox?.dispatchedAt).toBeInstanceOf(Date);
    expect(await scenario.immutable()).toEqual(immutable);
    expect(scenario.wire.additions()).toBe(1);
    const history = await root.fetchHistory();
    assertManualActivityOrder(history);
    await verifyMovieHistory(history, {
      node,
      script,
      directory,
      name: "manual-root",
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
