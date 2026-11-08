import {
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
import { createMovieCleanupWorkflowFixture } from "@shepherdjerred/media/testing/movie-cleanup-workflow";
import { createPlexCleanupActivities } from "./plex-cleanup.ts";

import {
  mediaWorkflowWorkerScript,
  movieWorkflowChildEnvironment,
  createMovieRoleEnvironment,
  closeMovieRoleFixture,
  pinnedMovieRuntimes,
  startMovieWorkflowWorker,
} from "./testing/role-worker.ts";
import { assertPrivateHistory } from "./testing/history.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

test.each([
  "default",
  "directors_cut",
  "extended_cut",
  "theatrical_cut",
  "final_cut",
  "unrated_cut",
  "uncut_version",
] as const)(
  "real role workers clean the exact %s upgrade and replay without private paths or publication proofs",
  async (edition) => {
    const { temporal, node } = pinnedMovieRuntimes();
    const directory = await mkdtemp(
      path.join(tmpdir(), "media-movie-cleanup-role-"),
    );
    const environment = await createMovieRoleEnvironment(temporal);
    let fixture:
      Awaited<ReturnType<typeof createMovieCleanupWorkflowFixture>> | undefined;
    let workflow: Bun.Subprocess | undefined;
    const workers: Worker[] = [];
    const running: Promise<void>[] = [];
    try {
      fixture = await createMovieCleanupWorkflowFixture(edition);
      const scenario = fixture;
      const initial = await scenario.evidence();
      expect(initial.cleanup.state).toBe("pending");
      expect(initial.old.state).toBe("superseded");
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
          ...createPlexCleanupActivities(() => Promise.resolve(scenario)),
          finishMediaOperation: scenario.finishMediaOperation,
        },
      });
      workers.push(network);
      running.push(network.run());
      const files = await createAcquisitionFileTestWorker(
        environment,
        "dev",
        () => Promise.resolve(scenario),
      );
      workers.push(files);
      running.push(files.run());
      let workflowId: string | undefined;
      const dispatched = await scenario.dispatch(async (start) => {
        if (start.input["operationId"] !== scenario.input.operationId)
          throw new Error(
            "Independent acquisition, captions and seeding commands remain queued",
          );
        expect(start.workflowType).toBe("cleanupMediaUpgradeWorkflow");
        await environment.client.workflow.start(start.workflowType, {
          workflowId: start.workflowId,
          taskQueue: TASK_QUEUES.WORKFLOWS,
          args: [start.input],
        });
        workflowId = start.workflowId;
      });
      expect(dispatched.dispatched).toBe(1);
      if (workflowId === undefined)
        throw new Error("Actual cleanup outbox did not start");
      const handle = environment.client.workflow.getHandle(workflowId);
      expect(
        await environment.client.connection.withDeadline(
          Date.now() + 20_000,
          () => handle.result(),
        ),
      ).toEqual({ status: "completed" });
      const final = await scenario.evidence();
      expect(final.cleanup.state).toBe("purged");
      expect(final.old).toMatchObject({ state: "purged", edition });
      expect(final.old.subtitles).toHaveLength(2);
      for (const subtitle of final.old.subtitles)
        expect(subtitle.state).toBe("purged");
      expect(final.successor).toEqual(initial.successor);
      expect(final.binding).toEqual(initial.binding);
      expect(final.publication).toEqual(initial.publication);
      expect(final.transition).toEqual(initial.transition);
      expect(final.operation).toMatchObject({
        status: "completed",
        result: {
          upgradeCleanupPlex: {
            evidence: { schemaVersion: 2, expected: { scope: scenario.scope } },
          },
        },
      });
      const history = historyToJSON(await handle.fetchHistory());
      assertPrivateHistory(history, [
        "Workflow.Fixture",
        "Workflow Fixture",
        "magnet:",
        "/data/movies",
        "/downloads",
        "upgradeCleanupPlex",
        "profileVersionAtCapture",
        "targetAuthority",
      ]);
      const historyPath = path.join(directory, "cleanup-history.json");
      await Bun.write(historyPath, history);
      await replayWorkflowFile({
        node: node,
        script: script,
        filename: historyPath,
        childEnvironment: childEnvironment,
      });
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
