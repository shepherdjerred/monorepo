import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { Worker } from "@temporalio/worker";

import { expect, test } from "vitest";
import { createMovieContinuationFixture } from "@shepherdjerred/media/testing/movie-retry-continuation-workflow";
import { startMovieRoleActivitiesV4 as startRoles } from "#activities/media/testing/movie-role-activities.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { verifyMovieHistory } from "#activities/media/testing/replay.ts";
import {
  mediaWorkflowWorkerScript,
  createMovieRoleEnvironment,
  closeMovieRoleFixture as closeRole,
  pinnedMovieRuntimes,
  startMovieWorkflowWorker,
} from "#activities/media/testing/role-worker.ts";

type Scenario = Awaited<ReturnType<typeof createMovieContinuationFixture>>;
type Evidence = Awaited<ReturnType<Scenario["evidence"]>>;
type Phase = "intent" | "imported" | "plex";

function birth(attempt: NonNullable<Evidence["attempt"]>) {
  return {
    id: attempt.id,
    operationId: attempt.operationId,
    edition: attempt.edition,
    releaseId: attempt.releaseId,
    sponsorRequestId: attempt.sponsorRequestId,
    mediaIds: attempt.mediaIds,
    generations: attempt.generations,
    recoveryEpoch: attempt.recoveryEpoch,
    identityEvidence: attempt.identityEvidence,
    movieEditionChoiceId: attempt.movieEditionChoiceId,
    movieEditionChoiceRevision: attempt.movieEditionChoiceRevision,
    movieEditionAuthority: attempt.movieEditionAuthority,
  };
}

async function assertCompleted(
  scenario: Scenario,
  before: Evidence,
  phase: Phase,
  retryId: string,
) {
  if (before.attempt === null || before.plan === null)
    throw new Error(
      "Actual failed native acquisition omitted its prepared plan",
    );
  const completed = await scenario.evidence();
  if (completed.attempt === null || completed.publication === null)
    throw new Error(
      "Actual native continuation omitted its completed physical acquisition",
    );
  expect(birth(completed.attempt)).toEqual(birth(before.attempt));
  expect(completed.attempt).toMatchObject({
    state: "completed",
    filePlan: before.attempt.filePlan,
    coordinatorOperationId:
      phase === "plex" ? before.attempt.coordinatorOperationId : retryId,
    torrentId: before.attempt.torrentId,
  });
  expect(completed.adds).toBe(1);
  expect(completed.torrentCount).toBe(1);
  expect(completed.assets).toHaveLength(1);
  expect(completed.assets[0]).toMatchObject({
    state: "published",
    owned: true,
    edition: scenario.input.scope.edition,
  });
  expect(completed.target.generation).toBe(before.target.generation);
  expect(completed.choices).toEqual(before.choices);
  expect(completed.requests).toEqual(before.requests);
  expect(completed.publication.id).toBe(before.publication?.id);
  expect(completed.publication.intent).toEqual(before.publication?.intent);
  expect(completed.publication.intentHash).toBe(before.publication?.intentHash);
  if (phase !== "intent")
    expect(completed.publication).toEqual(before.publication);
  if (phase === "plex")
    expect(completed.operation.result).toEqual(before.operation.result);
  return completed;
}

test.each(["intent", "imported", "plex"] as const)(
  "native movie %s recovery retains its actual immutable parents and replays original and resumed executions",
  async (phase) => {
    const { temporal, node } = pinnedMovieRuntimes();
    const directory = await mkdtemp(
      path.join(tmpdir(), "media-movie-continuation-role-"),
    );
    const environment = await createMovieRoleEnvironment(temporal);
    let fixture: Scenario | undefined;
    let workflow: Bun.Subprocess | undefined;
    const workers: Worker[] = [];
    const running: Promise<void>[] = [];
    try {
      fixture = await createMovieContinuationFixture("extended_cut");
      const scenario = fixture;
      const descriptions: {
        workflowId: string;
        runId: string;
        status: string;
      }[] = [];
      scenario.useDescriptions(async (workflowId) => {
        const actual = await environment.client.workflow
          .getHandle(workflowId)
          .describe();
        descriptions.push({
          workflowId,
          runId: actual.runId,
          status: actual.status.name,
        });
        return { runId: actual.runId, status: actual.status.name };
      });
      scenario.enableFailure(phase);
      const script = mediaWorkflowWorkerScript;
      const childEnvironment = { PATH: Bun.env["PATH"] ?? "/usr/bin:/bin" };
      workflow = await startMovieWorkflowWorker({
        node,
        script,
        address: environment.address,
        directory,
        childEnvironment,
      });
      await startRoles(environment, scenario, { workers, running });
      const dispatch = (operationId: string) =>
        scenario.dispatch(async (start) => {
          if (start.input["operationId"] !== operationId)
            throw new Error(
              "Only the actual movie continuation coordinator is dispatched",
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
      const before = await scenario.evidence();
      if (before.attempt === null || before.publication === null)
        throw new Error(
          "Actual native failure omitted its physical publication intent",
        );
      expect(before.operation.status).toBe("reconciling");
      expect(before.attempt.state).toBe(
        phase === "intent" ? "validating" : "imported",
      );
      expect(before.adds).toBe(1);
      const childId = `media-acquire-${before.attempt.id}`;
      const originalChild = environment.client.workflow.getHandle(childId);
      const root = await original.describe();
      const child = await originalChild.describe();
      expect(root.status.name).toBe("FAILED");
      expect(child.status.name).toBe("FAILED");
      const histories = [
        { name: "original-root", history: await original.fetchHistory() },
        { name: "original-child", history: await originalChild.fetchHistory() },
      ];
      const journals = await scenario.journalEvidence();
      const files = await scenario.fileEvidence();
      const checkpoints = scenario.control.physicalCheckpoints.length;
      scenario.allowRecovery();
      const queued = await scenario.retry();
      expect(await dispatch(queued.input.operationId)).toMatchObject({
        dispatched: 1,
      });
      const resumed = environment.client.workflow.getHandle(
        `media-operation-${queued.input.operationId}`,
      );
      expect(
        await environment.client.connection.withDeadline(
          Date.now() + 20_000,
          () => resumed.result(),
        ),
      ).toEqual(
        phase === "plex"
          ? { status: "completed", reason: "historical_plex_finalization" }
          : { status: "completed" },
      );
      await assertCompleted(scenario, before, phase, queued.input.operationId);
      expect(descriptions).toContainEqual({
        workflowId: `media-operation-${scenario.input.operationId}`,
        runId: root.runId,
        status: "FAILED",
      });
      expect(descriptions).toContainEqual({
        workflowId: childId,
        runId: child.runId,
        status: "FAILED",
      });
      if (phase !== "intent") {
        expect(await scenario.journalEvidence()).toEqual(journals);
        expect(await scenario.fileEvidence()).toEqual(files);
        expect(scenario.control.physicalCheckpoints).toHaveLength(checkpoints);
      }
      histories.push({
        name: "resumed-root",
        history: await resumed.fetchHistory(),
      });
      const resumedChild = environment.client.workflow.getHandle(childId);
      const currentChild = await resumedChild.describe();
      if (phase === "plex") {
        expect(currentChild.runId).toBe(child.runId);
        expect(currentChild.status.name).toBe("FAILED");
      } else {
        expect(currentChild.runId).not.toBe(child.runId);
        expect(currentChild.status.name).toBe("COMPLETED");
        histories.push({
          name: "resumed-child",
          history: await resumedChild.fetchHistory(),
        });
      }
      for (const entry of histories)
        await verifyMovieHistory(entry.history, {
          node,
          script,
          directory,
          name: entry.name,
          childEnvironment,
        });
    } finally {
      await closeRole({
        workers,
        running,
        workflow,
        fixture,
        environment,
        directory,
      });
    }
  },
  60_000,
);
