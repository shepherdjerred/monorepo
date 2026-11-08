import { replayWorkflowFile } from "#activities/media/testing/process.ts";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Worker } from "@temporalio/worker";
import type { TestWorkflowEnvironment } from "@temporalio/testing";
import { historyToJSON } from "@temporalio/common/lib/proto-utils.js";
import { expect } from "vitest";
import type { createPerEpisodeNativeRecoveryFixtureV1 } from "@shepherdjerred/media/testing/per-episode-native-recovery";
import { createSeedingWorkerActivities } from "#activities/media/seeding.ts";
import {
  pinnedMovieRuntimes,
  startMovieWorkflowWorker,
} from "#activities/media/testing/role-worker.ts";
import { assertPrivateHistory } from "#activities/media/testing/history.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  nativeSeriesPackPaidV1,
  nativeRecoverySdk,
} from "./native-recovery-phases.ts";
import { seriesPackRoleResult } from "./result.ts";

type Fixture = Awaited<
  ReturnType<typeof createPerEpisodeNativeRecoveryFixtureV1>
>;
type Input = Awaited<ReturnType<Fixture["nativeSourceInput"]>>;

/** Register this exact owner synchronously before run(). It uses the SAME
 * actual Temporal server and persisted native state as the interrupted work. */
export function createNativeSeriesPackSourceRoleV1(
  scenario: Fixture,
  environment: TestWorkflowEnvironment,
  charges: { method: string; paid: number }[],
) {
  let worker: Worker | undefined;
  let running: Promise<void> | undefined;
  let child: Bun.Subprocess | undefined;
  let directory: string | undefined;
  let execution: { workflowId: string; runId: string } | undefined;
  const close = async () => {
    const failures: unknown[] = [];
    const settle = async (work: () => Promise<unknown>) => {
      try {
        await work();
      } catch (error) {
        failures.push(error);
      }
    };
    const actual = execution;
    if (actual !== undefined)
      await settle(async () => {
        const handle = environment.client.workflow.getHandle(
          actual.workflowId,
          actual.runId,
        );
        const state = await environment.client.connection.withDeadline(
          Date.now() + 20_000,
          () => handle.describe(),
        );
        if (state.status.name === "RUNNING")
          await environment.client.connection.withDeadline(
            Date.now() + 20_000,
            () =>
              handle.terminate("Exact owned native source fixture teardown"),
          );
      });
    if (worker?.getState() === "RUNNING") worker.shutdown();
    if (running !== undefined) await settle(() => running ?? Promise.resolve());
    if (child !== undefined) {
      child.kill("SIGTERM");
      const owned = child;
      await settle(() => owned.exited);
      child = undefined;
    }
    const ownedDirectory = directory;
    if (ownedDirectory !== undefined)
      await settle(() => rm(ownedDirectory, { recursive: true, force: true }));
    directory = undefined;
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        "Owned native source role did not close",
      );
  };
  return {
    close,
    async run(input: Input, caseDeadline: number) {
      const { node } = pinnedMovieRuntimes();
      directory = await mkdtemp(
        path.join(tmpdir(), "media-native-series-source-"),
      );
      const script = new URL(
        "../../../../scripts/media-system/workflow-worker.ts",
        import.meta.url,
      ).pathname;
      const runtimePath = Bun.env["PATH"];
      if (runtimePath === undefined)
        throw new Error("Pinned credentialless runtime PATH missing");
      const childEnvironment = { PATH: runtimePath };
      child = await startMovieWorkflowWorker({
        node,
        script,
        address: environment.address,
        directory,
        childEnvironment,
      });
      const actual = createSeedingWorkerActivities(() =>
        Promise.resolve({ seeding: scenario.seeding }),
      );
      worker = await Worker.create({
        connection: environment.nativeConnection,
        namespace: "dev",
        taskQueue: TASK_QUEUES.MEDIA_NETWORK,
        activities: {
          evaluateMediaSeeding: async (raw: Input) => {
            const result = await nativeSeriesPackPaidV1(
              "source_role_evaluate",
              charges,
              () => actual.evaluateMediaSeeding(raw),
            );
            expect(result).toEqual({
              status: "removable",
              reason: "obligations_satisfied",
            });
            return result;
          },
          removeMediaTorrent: (raw: Input) =>
            nativeSeriesPackPaidV1("source_role_remove", charges, () =>
              actual.removeMediaTorrent(raw),
            ),
          finishMediaOperation: scenario.finishMediaOperation,
        },
      });
      running = worker.run();
      await scenario.refreshSourceAuthority();
      const dispatched = await scenario.dispatch(async (start) => {
        if (start.input["operationId"] !== input.operationId)
          throw new Error("Unrelated original commands remain queued");
        expect(start.workflowType).toBe("maintainMediaTorrentWorkflow");
        const handle = await environment.client.connection.withDeadline(
          Date.now() + 20_000,
          () =>
            environment.client.workflow.start(start.workflowType, {
              workflowId: start.workflowId,
              taskQueue: TASK_QUEUES.WORKFLOWS,
              args: [start.input],
            }),
        );
        execution = {
          workflowId: start.workflowId,
          runId: handle.firstExecutionRunId,
        };
      }, caseDeadline);
      expect(dispatched.dispatched).toBe(1);
      const started = execution;
      if (started === undefined)
        throw new Error("Actual Tokyo source outbox did not dispatch");
      expect(
        await seriesPackRoleResult({
          environment,
          workflowId: started.workflowId,
          caseDeadline,
        }),
      ).toEqual({ status: "completed" });
      const history = await environment.client.connection.withDeadline(
        Date.now() + 20_000,
        () =>
          environment.client.workflow
            .getHandle(started.workflowId, started.runId)
            .fetchHistory(),
      );
      const methods =
        history.events?.flatMap((event) =>
          event.activityTaskScheduledEventAttributes == null
            ? []
            : [event.activityTaskScheduledEventAttributes],
        ) ?? [];
      expect(methods.map((method) => method.activityType?.name)).toEqual([
        "evaluateMediaSeeding",
        "removeMediaTorrent",
        "finishMediaOperation",
      ]);
      for (const method of methods) {
        expect(method.taskQueue?.name).toBe(TASK_QUEUES.MEDIA_NETWORK);
        expect(Number(method.startToCloseTimeout?.seconds?.toString())).toBe(
          300,
        );
        expect(Number(method.scheduleToCloseTimeout?.seconds?.toString())).toBe(
          315_360_000,
        );
        expect(method.retryPolicy?.maximumAttempts).toBe(
          method.activityType?.name === "removeMediaTorrent" ? 1 : 3,
        );
      }
      const serialized = historyToJSON(history);
      assertPrivateHistory(serialized, [
        "magnet:",
        "/data/tv",
        "/downloads/media",
        "encryptedSource",
        "Synthetic.Anime",
      ]);
      const target = path.join(directory, "source-history.json");
      await Bun.write(target, serialized);
      await replayWorkflowFile({
        node: node,
        script: script,
        filename: target,
        childEnvironment: childEnvironment,
      });
    },
  };
}

export async function assertNativeSeriesPackSourceHoldV1(
  scenario: Fixture,
  input: Input,
  charges: { method: string; paid: number }[],
) {
  await scenario.refreshSourceAuthority();
  scenario.sourceRatio(0);
  const worker = createSeedingWorkerActivities(() =>
    Promise.resolve({ seeding: scenario.seeding }),
  );
  const original = await scenario.originalSeedInput(input.torrentId);
  expect(original.operationId).not.toBe(input.operationId);
  expect(
    await nativeSeriesPackPaidV1(
      "source_original_epoch_protected",
      charges,
      () =>
        nativeRecoverySdk(original.operationId, "source-original-epoch").run(
          worker.evaluateMediaSeeding,
          {
            operationId: original.operationId,
            torrentId: original.torrentId,
          },
        ),
    ),
  ).toEqual({ status: "protected", reason: "source_cleanup_disabled" });
  expect(await scenario.originalSeedInput(input.torrentId)).toEqual(original);
  expect(
    await nativeSeriesPackPaidV1("source_real_ratio_zero", charges, () =>
      nativeRecoverySdk(input.operationId, "source-ratio-zero").run(
        worker.evaluateMediaSeeding,
        input,
      ),
    ),
  ).toEqual({ status: "seeding", reason: "seeding_required" });
  expect(scenario.sourceRemovals()).toBe(0);
}
