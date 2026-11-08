import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { expect, test } from "vitest";
import { createMovieRollbackHandoffRoleFixture } from "@shepherdjerred/media/testing/movie-rollback-handoff";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  mediaWorkflowWorkerScript,
  movieWorkflowChildEnvironment,
  pinnedMovieRuntimes,
  startMovieWorkflowWorker,
  closeMovieRoleFixtureSequential,
} from "#activities/media/testing/role-worker.ts";
import { verifyMovieHistory } from "#activities/media/testing/replay.ts";
import type { HandoffScenario } from "./rollback-handoff.test-support.ts";
import {
  repeatedOwnerInterruption,
  repeatedHandoffRoles,
} from "./rollback-repeated-handoff.test-support.ts";

test("a second terminated rollback owner is replaced through the current handoff without replaying either prior ACK", async () => {
  const { node } = pinnedMovieRuntimes();
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  const directory = await mkdtemp(
    path.join(tmpdir(), "media-rollback-repeated-"),
  );
  let scenario: HandoffScenario | undefined;
  let workflow: Bun.Subprocess | undefined;
  let roles: Awaited<ReturnType<typeof repeatedHandoffRoles>> | undefined;
  let interruption: ReturnType<typeof repeatedOwnerInterruption> | undefined;
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
    const before = await fixture.state();
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
    interruption = repeatedOwnerInterruption(fixture);
    roles = await repeatedHandoffRoles(environment, fixture, interruption);
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
    let operationId = fixture.input.operationId;
    const stopped = [];
    const admissions = [];
    for (let cycle = 0; cycle < 2; cycle++) {
      const pause = interruption.pause(operationId);
      const dispatched = await dispatch();
      expect(dispatched.dispatched).toBe(1);
      const run = environment.client.workflow.getHandle(
        `media-operation-${operationId}`,
      );
      await pause.acked.promise;
      const active = await run.describe();
      expect(active.status.name).toBe("RUNNING");
      await run.terminate("Actual owner interrupted after its next native ACK");
      pause.proceed.resolve(undefined);
      await pause.settled.promise;
      const closed = await run.describe();
      expect(closed.status.name).toBe("TERMINATED");
      stopped.push({ run, description: closed });
      const receipts = await fixture.receipts();
      expect(receipts.movieRollbackPhysicalV1).toBeUndefined();
      expect(receipts.movieRollbackIntentV1).toBeDefined();
      admissions.push(receipts.movieRollbackIntentV1);
      const records = await fixture.captionRecords();
      expect(records.records).toHaveLength(cycle + 1);
      const current = await fixture.service.read(fixture.owner, fixture.scope);
      if (current.state !== "retry")
        throw new Error("Actual closed current owner has no retry review");
      const queued = await fixture.service.retry(
        fixture.owner,
        crypto.randomUUID(),
        {
          ...current.command,
          reason:
            "Resume the same admitted rollback after the actual current owner stopped",
          confirmResumeAdmittedRollback: true,
        },
      );
      operationId = queued.operationId;
    }
    const prefix = await fixture.captionRecords();
    const priorHandoffs = await fixture.handoffs();
    expect(priorHandoffs).toHaveLength(1);
    const previous = priorHandoffs[0];
    const previousRun = stopped[1];
    if (previous === undefined || previousRun === undefined)
      throw new Error("Actual first retry handoff/run missing");
    const dispatched = await dispatch();
    expect(dispatched.dispatched).toBe(1);
    const final = environment.client.workflow.getHandle(
      `media-operation-${operationId}`,
    );
    expect(await final.result()).toEqual({ status: "completed" });
    const finalDescription = await final.describe();
    const handoffs = await fixture.handoffs();
    expect(handoffs).toHaveLength(2);
    expect(handoffs.find((event) => event.id === previous.id)).toEqual(
      previous,
    );
    const latest = handoffs.find((event) => event.id !== previous.id);
    if (latest === undefined)
      throw new Error("Actual current replacement handoff missing");
    expect(latest.payload).toMatchObject({
      handoff: {
        previous: { eventId: previous.id },
        previousOwner: { runId: previousRun.description.runId },
        closedOwner: {
          runId: previousRun.description.runId,
          status: "TERMINATED",
        },
        owner: { runId: finalDescription.runId },
      },
    });
    const command = await fixture.command();
    expect(command.result).toMatchObject({
      movieRollbackOwnerV1: { eventId: latest.id },
    });
    const complete = await fixture.captionRecords();
    expect(complete.records).toHaveLength(6);
    expect(complete.records.slice(0, 2)).toEqual(prefix.records);
    expect(interruption.acknowledgements).toHaveLength(6);
    expect(await fixture.retryCommands()).toHaveLength(2);
    const receipts = await fixture.receipts();
    expect(receipts.movieRollbackIntentV1).toEqual(admissions[0]);
    expect(admissions[1]).toEqual(admissions[0]);
    expect(receipts.movieRollbackPhysicalV1).toBeDefined();
    expect(receipts.movieRollbackPlexV1).toBeDefined();
    const after = await fixture.state();
    expect(after.files.map(({ path: _path, ...file }) => file)).toEqual(
      before.files.map(({ path: _path, ...file }) => file),
    );
    expect(after.cleanup).toEqual({
      ...before.cleanup,
      state: "cancelled",
      version: before.cleanup.version + 1,
    });
    expect(await fixture.immutable()).toEqual(immutable);
    expect(fixture.wire.additions()).toBe(1);
    for (const [index, handle] of [
      ...stopped.map(({ run }) => run),
      final,
    ].entries())
      await verifyMovieHistory(await handle.fetchHistory(), {
        node,
        script,
        directory,
        name: `owner-${String(index)}`,
        childEnvironment,
      });
  } finally {
    interruption?.release();
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
