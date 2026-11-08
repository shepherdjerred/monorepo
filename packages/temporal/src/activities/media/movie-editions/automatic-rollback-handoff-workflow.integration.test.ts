import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { expect, test } from "vitest";
import { createAutomaticMovieRollbackHandoffFixture } from "@shepherdjerred/media/testing/movie-automatic-rollback-handoff";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  mediaWorkflowWorkerScript,
  movieWorkflowChildEnvironment,
  pinnedMovieRuntimes,
  startMovieWorkflowWorker,
  closeMovieRoleFixtureSequential,
} from "#activities/media/testing/role-worker.ts";
import { verifyMovieHistory } from "#activities/media/testing/replay.ts";
import {
  automaticHandoffInterruption,
  automaticHandoffRoles,
  type AutomaticHandoffScenario,
} from "./automatic-rollback-handoff.test-support.ts";

async function assertAutomaticCompletion(
  scenario: AutomaticHandoffScenario,
  before: {
    immutable: Awaited<ReturnType<AutomaticHandoffScenario["immutable"]>>;
    state: Awaited<ReturnType<AutomaticHandoffScenario["state"]>>;
  },
  originalIntent: NonNullable<
    Awaited<
      ReturnType<AutomaticHandoffScenario["receipts"]>
    >["movieRollbackIntentV1"]
  >,
  executions: { root: string; child: string; replacement: string },
) {
  const completed = await scenario.receipts();
  expect(completed.movieRollbackIntentV1).toEqual(originalIntent);
  expect(completed.movieRollbackPhysicalV1).toBeDefined();
  expect(completed.movieRollbackPlexV1).toBeDefined();
  expect(await scenario.handoffs()).toHaveLength(1);
  const handoffs = await scenario.handoffs();
  expect(handoffs[0]?.payload).toMatchObject({
    handoff: {
      operationId: scenario.input.operationId,
      previousOwner: {
        workflowId: `media-acquire-${scenario.input.attemptId}`,
        runId: executions.child,
      },
      closedOwner: {
        workflowId: `media-acquire-${scenario.input.attemptId}`,
        runId: executions.child,
        status: "TERMINATED",
      },
      closedSourceRoot: {
        workflowId: `media-operation-${scenario.input.operationId}`,
        runId: executions.root,
        status: "TERMINATED",
      },
      owner: { runId: executions.replacement },
    },
  });
  const playback = await scenario.playback();
  expect(playback).toHaveLength(1);
  expect(playback[0]?.payload).toMatchObject({
    guard: {
      operationId: scenario.input.operationId,
      intentId: originalIntent.intent.id,
      intentHash: originalIntent.intentHash,
      sessions: { state: "clear" },
      paths: expect.arrayContaining([
        originalIntent.intent.predecessor.path,
        originalIntent.intent.successor.path,
      ]),
    },
  });
  expect(
    await scenario.db.applicationEvent.count({
      where: {
        kind: "movie_rollback_playback_v1",
        mediaId: scenario.scope.mediaId,
      },
    }),
  ).toBe(0);
  const state = await scenario.state();
  expect(state.predecessor).toMatchObject({
    state: "published",
    path: scenario.baseline.path,
  });
  expect(state.successor.state).toBe("rejected");
  expect(state.bytes).toEqual(before.state.bytes);
  expect(
    state.predecessor.subtitles
      .filter(
        (caption) =>
          caption.storageKind === "sidecar" && caption.state === "installed",
      )
      .map((caption) => caption.language)
      .sort(),
  ).toEqual(["en", "zh-Hans"]);
  expect(await scenario.immutable()).toEqual(before.immutable);
  expect(scenario.wire.additions()).toBe(1);
}

test("a real interrupted automatic rollback closes both original runs and resumes its first-ACK inverse through owner consent and fresh sessions", async () => {
  const { node } = pinnedMovieRuntimes();
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  const directory = await mkdtemp(
    path.join(tmpdir(), "media-auto-rollback-handoff-"),
  );
  let scenario: AutomaticHandoffScenario | undefined;
  let workflow: Bun.Subprocess | undefined;
  let roles: Awaited<ReturnType<typeof automaticHandoffRoles>> | undefined;
  let interruption: ReturnType<typeof automaticHandoffInterruption> | undefined;
  try {
    scenario = await createAutomaticMovieRollbackHandoffFixture(
      async (workflowId) => {
        const actual = await environment.client.workflow
          .getHandle(workflowId)
          .describe();
        return { status: actual.status.name, runId: actual.runId };
      },
    );
    const fixture = scenario;
    const before = {
      immutable: await fixture.immutable(),
      state: await fixture.state(),
    };
    const script = mediaWorkflowWorkerScript;
    const childEnvironment = movieWorkflowChildEnvironment();
    workflow = await startMovieWorkflowWorker({
      node,
      script,
      address: environment.address,
      directory,
      childEnvironment,
      namespace: "default",
    });
    interruption = automaticHandoffInterruption(fixture);
    roles = await automaticHandoffRoles(environment, fixture, interruption);
    const dispatch = () =>
      fixture.dispatch(async (start) => {
        if (
          start.workflowId !== `media-operation-${fixture.input.operationId}` &&
          start.workflowType !== "rollbackMovieEditionV1Workflow"
        )
          throw new Error("Unrelated original command retains its own worker");
        await environment.client.workflow.start(start.workflowType, {
          workflowId: start.workflowId,
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [start.input],
        });
      });
    const originalDispatch = await dispatch();
    expect(originalDispatch.dispatched).toBe(1);
    const root = environment.client.workflow.getHandle(
      `media-operation-${fixture.input.operationId}`,
    );
    // The real SDK wait unlocks Temporal's thirty durable timers; wall clocks and caps are untouched.
    const originalResult = Promise.allSettled([root.result()]);
    await interruption.admitted;
    expect(fixture.results).toHaveLength(30);
    expect(
      fixture.results.every(
        (result) => result.status === "waiting" && result.reason !== null,
      ),
    ).toBe(true);
    const admitted = await fixture.receipts();
    const originalIntent = admitted.movieRollbackIntentV1;
    if (originalIntent === undefined)
      throw new Error("Actual original automatic admission missing");
    expect(originalIntent.intent.invocation.mode).toBe("automatic_failed_plex");
    expect(originalIntent.intent.playback).toBeUndefined();
    const reviewed = await fixture.retryReview();
    expect(
      await fixture.service.read(fixture.owner, fixture.scope),
    ).toMatchObject({
      state: "in_progress",
      reason: "workflow_running",
      command: null,
    });
    await expect(
      fixture.service.retry(fixture.owner, crypto.randomUUID(), reviewed),
    ).rejects.toMatchObject({ status: 409 });
    expect(await fixture.handoffs()).toEqual([]);
    expect(await fixture.retryCommands()).toEqual([]);
    interruption.continueAdmission();
    await interruption.acked;
    const child = environment.client.workflow.getHandle(
      `media-acquire-${fixture.input.attemptId}`,
    );
    const originalRoot = await root.describe(),
      originalChild = await child.describe();
    await root.terminate(
      "Actual original root stops after its child's durable inverse ACK",
    );
    const childAfterRoot = await child.describe();
    if (childAfterRoot.status.name === "RUNNING")
      await child.terminate("Stop actual admitted inverse executor");
    interruption.continueAck();
    await interruption.settled;
    expect(await originalResult).toEqual([
      expect.objectContaining({ status: "rejected" }),
    ]);
    const rootStopped = await root.describe(),
      childStopped = await child.describe();
    expect(rootStopped.status.name).toBe("TERMINATED");
    expect(childStopped.status.name).toBe("TERMINATED");
    const interrupted = await fixture.receipts();
    expect(interrupted.movieRollbackPhysicalV1).toBeUndefined();
    const prefix = await fixture.inverseRecords();
    expect(prefix.records).toHaveLength(1);
    await expect(
      fixture.unknownService.retry(
        fixture.owner,
        crypto.randomUUID(),
        reviewed,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await fixture.retryCommands()).toEqual([]);
    const current = await fixture.service.read(fixture.owner, fixture.scope);
    if (current.state !== "retry")
      throw new Error(
        "Actual terminal automatic inverse has no owner retry review",
      );
    const queued = await fixture.service.retry(
      fixture.owner,
      crypto.randomUUID(),
      {
        ...current.command,
        reason: reviewed.reason,
        confirmResumeAdmittedRollback: true,
      },
    );
    const retryDispatch = await dispatch();
    expect(retryDispatch.dispatched).toBe(1);
    const replacement = environment.client.workflow.getHandle(
      `media-operation-${queued.operationId}`,
    );
    expect(await replacement.result()).toEqual({ status: "completed" });
    const closed = await replacement.describe();
    expect(closed.status.name).toBe("COMPLETED");
    const records = await fixture.inverseRecords();
    expect(records.records.slice(0, prefix.records.length)).toEqual(
      prefix.records,
    );
    expect(interruption.acknowledgements).toHaveLength(records.records.length);
    await assertAutomaticCompletion(fixture, before, originalIntent, {
      root: originalRoot.runId,
      child: originalChild.runId,
      replacement: closed.runId,
    });
    for (const [name, handle] of [
      ["automatic-root", root],
      ["automatic-child", child],
      ["automatic-resumed", replacement],
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
    await closeMovieRoleFixtureSequential({
      stopActivities: async () => {
        if (roles !== undefined) {
          for (const worker of roles.workers) worker.shutdown();
          await Promise.all(roles.running);
        }
      },
      workflow,
      fixture: scenario,
      environment,
      directory,
    });
  }
}, 90_000);
