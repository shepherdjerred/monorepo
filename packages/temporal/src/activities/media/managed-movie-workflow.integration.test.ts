import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { Worker } from "@temporalio/worker";

import { expect, test } from "vitest";
import { createManagedMovieWorkflowFixture } from "@shepherdjerred/media/testing/managed-movie-workflow";
import { startMovieRoleActivitiesV4 } from "./testing/movie-role-activities.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { verifyMovieHistory } from "./testing/replay.ts";
import {
  mediaWorkflowWorkerScript,
  createMovieRoleEnvironment,
  closeMovieRoleFixture,
  pinnedMovieRuntimes,
  startMovieWorkflowWorker,
} from "./testing/role-worker.ts";

test.each([
  "default",
  "theatrical_cut",
  "directors_cut",
  "extended_cut",
  "final_cut",
  "unrated_cut",
  "uncut_version",
] as const)(
  "real role workers upgrade the adopted %s library from its management outbox without personal requests",
  async (edition) => {
    const { temporal, node } = pinnedMovieRuntimes();
    const directory = await mkdtemp(
      path.join(tmpdir(), "media-managed-movie-role-"),
    );
    const environment = await createMovieRoleEnvironment(temporal);
    let fixture:
      Awaited<ReturnType<typeof createManagedMovieWorkflowFixture>> | undefined;
    let workflow: Bun.Subprocess | undefined;
    const workers: Worker[] = [];
    const running: Promise<void>[] = [];
    try {
      fixture = await createManagedMovieWorkflowFixture(edition);
      const scenario = fixture;
      const initial = await scenario.evidence();
      expect(initial.attempts).toEqual([]);
      expect(initial.personalRequests).toBe(0);
      expect(initial.personalChoices).toBe(0);
      const script = mediaWorkflowWorkerScript;
      const childEnvironment = { PATH: Bun.env["PATH"] ?? "/usr/bin:/bin" };
      workflow = await startMovieWorkflowWorker({
        node,
        script,
        address: environment.address,
        directory,
        childEnvironment,
      });
      await startMovieRoleActivitiesV4(environment, scenario, {
        workers,
        running,
      });
      const dispatched = await scenario.dispatch(async (start) => {
        if (start.input["operationId"] !== scenario.input.operationId)
          throw new Error(
            "Other import and independent seeding commands remain queued in this upgrade fixture",
          );
        expect(start.workflowType).toBe("reconcileMovieEditionV4Workflow");
        await environment.client.workflow.start(start.workflowType, {
          workflowId: start.workflowId,
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [start.input],
        });
      });
      expect(dispatched.dispatched).toBe(1);
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
      expect(evidence.operation).toMatchObject({
        status: "completed",
        outbox: { dispatchedAt: expect.any(Date) },
      });
      expect(evidence.personalRequests).toBe(0);
      expect(evidence.personalChoices).toBe(0);
      expect(evidence.attempts).toHaveLength(1);
      const attempt = evidence.attempts[0];
      if (attempt === undefined)
        throw new Error("Actual library upgrade attempt missing");
      expect(attempt).toMatchObject({
        edition,
        state: "completed",
        sponsorRequestId: null,
        movieEditionChoiceId: null,
        movieEditionAuthority: {
          kind: "library_management",
          receiptId: scenario.receiptId,
        },
        identityEvidence: { schemaVersion: 3 },
        reservations: [],
        torrent: { owned: true },
      });
      expect(evidence.assets).toHaveLength(2);
      expect(evidence.assets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: scenario.originalAssetId,
            state: "superseded",
          }),
          expect.objectContaining({ edition, state: "published" }),
        ]),
      );
      expect(evidence.binding.revision).toBe(initial.binding.revision + 1);
      expect(evidence.adds).toBe(1);
      for (const [name, handle] of [
        ["parent", parent],
        [
          "child",
          environment.client.workflow.getHandle(`media-acquire-${attempt.id}`),
        ],
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
      await closeMovieRoleFixture({
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
