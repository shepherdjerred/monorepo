import {
  plexRoleActivities,
  createMediaActivityTestWorker,
  createAcquisitionFileTestWorker,
} from "#activities/media/testing/activity-workers.ts";
import { replayWorkflowFile } from "#activities/media/testing/process.ts";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { Worker } from "@temporalio/worker";

import { historyToJSON } from "@temporalio/common/lib/proto-utils.js";
import { expect, test } from "vitest";
import { createManagedSeriesWorkflowFixture } from "@shepherdjerred/media/testing/managed-series-workflow";
import { createAcquisitionNetworkWorkerActivities } from "./acquisition.ts";

import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  mediaWorkflowWorkerScript,
  movieWorkflowChildEnvironment,
  createMovieRoleEnvironment,
  closeMovieRoleFixture,
  pinnedMovieRuntimes,
  startMovieWorkflowWorker,
} from "./testing/role-worker.ts";
import { assertPrivateHistory } from "./testing/history.ts";

test.each(["single_batch", "series_batches", "episode_batches"] as const)(
  "real role workers upgrade a %s pack through the recurring outbox and replay without personal requests",
  async (layout) => {
    const { temporal, node } = pinnedMovieRuntimes();
    const directory = await mkdtemp(
      path.join(tmpdir(), "media-managed-series-role-"),
    );
    const environment = await createMovieRoleEnvironment(temporal);
    let fixture:
      | Awaited<ReturnType<typeof createManagedSeriesWorkflowFixture>>
      | undefined;
    let workflow: Bun.Subprocess | undefined;
    const workers: Worker[] = [];
    const running: Promise<void>[] = [];
    try {
      fixture = await createManagedSeriesWorkflowFixture(
        layout === "single_batch"
          ? {}
          : { crossBatch: layout === "series_batches" ? "series" : "episodes" },
      );
      const scenario = fixture;
      const initial = await scenario.evidence();
      expect(initial.attempts).toEqual([]);
      expect(initial.personalRequests).toBe(0);
      expect(initial.operations).toHaveLength(2);
      const script = mediaWorkflowWorkerScript;
      const childEnvironment = movieWorkflowChildEnvironment();
      workflow = await startMovieWorkflowWorker({
        node,
        script,
        address: environment.address,
        directory,
        childEnvironment,
      });
      const network = await createMediaActivityTestWorker(environment, {
        namespace: "dev",
        taskQueue: TASK_QUEUES.MEDIA_NETWORK,
        activities: {
          ...createAcquisitionNetworkWorkerActivities(() =>
            Promise.resolve({ acquisition: scenario.acquisition }),
          ),
          ...plexRoleActivities(() => Promise.resolve(scenario)),
          finishMediaOperation: scenario.finishMediaOperation,
        },
      });
      workers.push(network);
      running.push(network.run());
      const files = await createAcquisitionFileTestWorker(
        environment,
        "dev",
        () => Promise.resolve({ acquisition: scenario.fileAcquisition }),
      );
      workers.push(files);
      running.push(files.run());
      const started: string[] = [];
      const dispatched = await scenario.dispatch(async (start) => {
        if (
          !initial.operations.some(
            (operation) => operation.id === start.input["operationId"],
          )
        )
          throw new Error(
            "Other adoption and independent commands stay queued",
          );
        expect(start.workflowType).toBe("reconcileMediaWorkflow");
        await environment.client.workflow.start(start.workflowType, {
          workflowId: start.workflowId,
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [start.input],
        });
        started.push(start.workflowId);
      });
      expect(dispatched.dispatched).toBe(2);
      const results = await environment.client.connection.withDeadline(
        Date.now() + 20_000,
        () =>
          Promise.all(
            started.map((id) =>
              environment.client.workflow.getHandle(id).result(),
            ),
          ),
      );
      expect(results).toContainEqual({ status: "completed" });
      const evidence = await scenario.evidence();
      expect(evidence.personalRequests).toBe(0);
      expect(evidence.attempts).toHaveLength(1);
      const attempt = evidence.attempts[0];
      if (attempt === undefined)
        throw new Error("Actual shared episode upgrade missing");
      expect(attempt).toMatchObject({
        state: "completed",
        sponsorRequestId: null,
        identityEvidence: {
          schemaVersion: 4,
          management: scenario.expectedManagement,
        },
        reservations: [],
        torrent: { owned: true },
      });
      expect([...attempt.mediaIds].sort()).toEqual(
        [...scenario.mediaIds].sort(),
      );
      expect(evidence.assets).toHaveLength(
        scenario.originalAssetIds.length * 2,
      );
      expect(
        evidence.assets.filter((asset) => asset.state === "published"),
      ).toHaveLength(scenario.originalAssetIds.length);
      for (const id of scenario.originalAssetIds)
        expect(evidence.assets.find((asset) => asset.id === id)).toMatchObject({
          state: "superseded",
        });
      expect(evidence.bindings).toHaveLength(scenario.mediaIds.length);
      expect(
        evidence.bindings.map((binding) => binding.mediaId).sort(),
      ).toEqual([...scenario.mediaIds].sort());
      for (const binding of evidence.bindings) {
        const prior = initial.bindings.find(
          (row) => row.mediaId === binding.mediaId,
        );
        if (prior === undefined)
          throw new Error("Actual initial serving binding missing");
        expect(binding.revision).toBe(prior.revision + 1);
      }
      expect(evidence.adds).toBe(1);
      for (const id of [...started, `media-acquire-${attempt.id}`]) {
        const history = await environment.client.workflow
          .getHandle(id)
          .fetchHistory();
        const serialized = historyToJSON(history);
        assertPrivateHistory(serialized, [
          "magnet:",
          "Synthetic.Anime",
          "synthetic-series:",
          "library_series_management",
          "seriesMonitoring",
          "profileVersionAtCapture",
          "selectionHash",
          "encryptedSource",
          "/data/tv",
          "/downloads/media",
        ]);
        const target = path.join(directory, `${id}.json`);
        await Bun.write(target, serialized);
        await replayWorkflowFile({
          node: node,
          script: script,
          filename: target,
          childEnvironment: childEnvironment,
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
