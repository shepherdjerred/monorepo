import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Worker } from "@temporalio/worker";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { expect, test } from "vitest";
import { createManagedMovieWorkflowFixture } from "@shepherdjerred/media/testing/managed-movie-workflow";
import {
  createMovieNetworkWorkerActivitiesV4,
  createMovieFileWorkerActivitiesV4,
} from "./movie-editions.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { verifyMovieHistory } from "./testing/replay.ts";
import {
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
    const environment = await TestWorkflowEnvironment.createLocal({
      server: {
        executable: { type: "existing-path", path: temporal },
        ip: "127.0.0.1",
        namespace: "dev",
        ui: false,
      },
    });
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
          ...createMovieNetworkWorkerActivitiesV4(() =>
            Promise.resolve({ movie: scenario.movie }),
          ),
          finishMediaOperation: scenario.finishMediaOperation,
        },
      });
      workers.push(network);
      running.push(network.run());
      const files = await Worker.create({
        connection: environment.nativeConnection,
        namespace: "dev",
        taskQueue: TASK_QUEUES.MEDIA_FILES,
        activities: createMovieFileWorkerActivitiesV4(() =>
          Promise.resolve({ movie: scenario.fileMovie }),
        ),
      });
      workers.push(files);
      running.push(files.run());
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
  },
  60_000,
);
