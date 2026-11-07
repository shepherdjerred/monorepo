import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { expect, test } from "vitest";
import { createMovieRollbackHandoffRoleFixture } from "@shepherdjerred/media/testing/movie-rollback-handoff";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  pinnedMovieRuntimes,
  startMovieWorkflowWorker,
} from "#activities/media/testing/role-worker.ts";
import { verifyMovieHistory } from "#activities/media/testing/replay.ts";
import {
  handoffInterruption,
  handoffRoles,
  type HandoffScenario,
} from "#activities/media/movie-editions/rollback-handoff.test-support.ts";

async function assertActiveOwnerProtection(scenario: HandoffScenario) {
  const reviewed = await scenario.retryReview();
  const view = await scenario.service.read(scenario.owner, scenario.scope);
  expect(view).toMatchObject({
    state: "in_progress",
    reason: "workflow_running",
    command: null,
  });
  await expect(
    scenario.service.retry(scenario.owner, crypto.randomUUID(), reviewed),
  ).rejects.toMatchObject({ status: 409 });
  expect(await scenario.handoffs()).toEqual([]);
  expect(await scenario.retryCommands()).toEqual([]);
  return reviewed;
}

async function assertHandoffClosure(
  scenario: HandoffScenario,
  before: {
    immutable: Awaited<ReturnType<HandoffScenario["immutable"]>>;
    state: Awaited<ReturnType<HandoffScenario["state"]>>;
  },
  originalIntent: unknown,
  runs: { original: string; replacement: string },
) {
  const receipts = await scenario.receipts();
  expect(receipts.movieRollbackIntentV1).toEqual(originalIntent);
  expect(receipts.movieRollbackPhysicalV1).toBeDefined();
  expect(receipts.movieRollbackPlexV1).toBeDefined();
  const handoffs = await scenario.handoffs();
  expect(handoffs).toHaveLength(1);
  expect(handoffs[0]?.payload).toMatchObject({
    handoff: {
      previousOwner: { runId: runs.original },
      closedOwner: { runId: runs.original, status: "TERMINATED" },
      owner: { runId: runs.replacement },
      closedSourceRoot: null,
    },
  });
  const state = await scenario.state();
  expect(
    state.assets.find((asset) => asset.id === scenario.asset.id),
  ).toMatchObject({ state: "published", path: scenario.baseline.path });
  expect(
    state.assets.find((asset) => asset.id === scenario.plan.entries[0].assetId),
  ).toMatchObject({ state: "rejected" });
  expect(state.cleanup).toEqual({
    ...before.state.cleanup,
    state: "cancelled",
    version: before.state.cleanup.version + 1,
  });
  expect(state.files.map(({ path: _path, ...file }) => file)).toEqual(
    before.state.files.map(({ path: _path, ...file }) => file),
  );
  expect(await scenario.immutable()).toEqual(before.immutable);
  expect(scenario.wire.additions()).toBe(1);
}

test("a real terminal owner hands its admitted caption WAL to a fresh outbox run without repeating the first ACK", async () => {
  const { node } = pinnedMovieRuntimes();
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  const directory = await mkdtemp(
    path.join(tmpdir(), "media-rollback-handoff-"),
  );
  let scenario: HandoffScenario | undefined;
  let workflow: Bun.Subprocess | undefined;
  let roles: Awaited<ReturnType<typeof handoffRoles>> | undefined;
  let interruption: ReturnType<typeof handoffInterruption> | undefined;
  try {
    scenario = await createMovieRollbackHandoffRoleFixture(
      async (workflowId) => {
        const actual = await environment.client.workflow
          .getHandle(workflowId)
          .describe();
        return { status: actual.status.name, runId: actual.runId };
      },
    );
    const fixture = scenario;
    const immutable = await fixture.immutable();
    const beforeState = await fixture.state();
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
    interruption = handoffInterruption(fixture);
    roles = await handoffRoles(environment, fixture, interruption);
    const dispatch = () =>
      fixture.dispatch(async (start) => {
        if (start.workflowType !== "rollbackMovieEditionV1Workflow")
          throw new Error(
            "Unrelated outbox command remains for its own worker",
          );
        await environment.client.workflow.start(start.workflowType, {
          workflowId: start.workflowId,
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [start.input],
        });
      });
    const firstDispatch = await dispatch();
    expect(firstDispatch.dispatched).toBe(1);
    const original = environment.client.workflow.getHandle(
      `media-operation-${fixture.input.operationId}`,
    );
    await interruption.admitted;
    const reviewed = await assertActiveOwnerProtection(fixture);
    const admittedReceipts = await fixture.receipts();
    const originalIntent = admittedReceipts.movieRollbackIntentV1;
    const originalDescription = await original.describe();
    interruption.continueAdmission();
    await interruption.acked;
    const firstAck = interruption.acknowledgements[0];
    expect(firstAck).toBeDefined();
    await original.terminate("Actual native first-ACK owner interruption");
    interruption.continueAck();
    await interruption.settled;
    const terminated = await original.describe();
    expect(terminated.status.name).toBe("TERMINATED");
    const interruptedReceipts = await fixture.receipts();
    expect(interruptedReceipts.movieRollbackPhysicalV1).toBeUndefined();
    const prefix = await fixture.captionRecords();
    expect(prefix.records).toHaveLength(1);
    expect(prefix.records[0]?.record.effect.step).toBe("move_link");
    await expect(
      fixture.unknownService.retry(
        fixture.owner,
        crypto.randomUUID(),
        reviewed,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await fixture.handoffs()).toEqual([]);
    expect(await fixture.retryCommands()).toEqual([]);
    const current = await fixture.service.read(fixture.owner, fixture.scope);
    expect(current.state).toBe("retry");
    if (current.state !== "retry")
      throw new Error("Actual terminal owner has no retry review");
    const queued = await fixture.service.retry(
      fixture.owner,
      crypto.randomUUID(),
      {
        ...current.command,
        reason: reviewed.reason,
        confirmResumeAdmittedRollback: true,
      },
    );
    const queuedView = await fixture.service.read(fixture.owner, fixture.scope);
    expect(queuedView).toMatchObject({
      state: "in_progress",
      reason: "workflow_state_unknown",
      command: null,
    });
    expect(await fixture.retryCommands()).toHaveLength(1);
    const retryDispatch = await dispatch();
    expect(retryDispatch.dispatched).toBe(1);
    const replacement = environment.client.workflow.getHandle(
      `media-operation-${queued.operationId}`,
    );
    expect(await replacement.result()).toEqual({ status: "completed" });
    const closed = await replacement.describe();
    expect(closed.status.name).toBe("COMPLETED");
    expect(interruption.acknowledgements).toHaveLength(6);
    const completedRecords = await fixture.captionRecords();
    expect(completedRecords.records).toHaveLength(6);
    expect(completedRecords.records.slice(0, prefix.records.length)).toEqual(
      prefix.records,
    );
    await assertHandoffClosure(
      fixture,
      { immutable, state: beforeState },
      originalIntent,
      {
        original: originalDescription.runId,
        replacement: closed.runId,
      },
    );
    for (const [name, handle] of [
      ["stopped-original", original],
      ["resumed-owner", replacement],
    ] as const)
      await verifyMovieHistory(await handle.fetchHistory(), {
        node,
        script,
        directory,
        name,
        childEnvironment,
      });
  } finally {
    interruption?.continueAdmission();
    interruption?.continueAck();
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
        await scenario?.close();
      } finally {
        await environment.teardown();
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
}, 90_000);
