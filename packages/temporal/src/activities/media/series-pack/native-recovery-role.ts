import { replayWorkflowFile } from "#activities/media/testing/process.ts";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Worker } from "@temporalio/worker";
import { historyToJSON } from "@temporalio/common/lib/proto-utils.js";
import type { TestWorkflowEnvironment } from "@temporalio/testing";
import { expect } from "vitest";
import type { NativeCompensationActivityInput } from "@shepherdjerred/media/native-compensation";
import type { createPerEpisodeNativeRecoveryFixtureV1 } from "@shepherdjerred/media/testing/per-episode-native-recovery";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  pinnedMovieRuntimes,
  startMovieWorkflowWorker,
} from "#activities/media/testing/role-worker.ts";
import { assertPrivateHistory } from "#activities/media/testing/history.ts";
import {
  nativeSeriesPackPaidV1,
  nativeSeriesPackNetworkAdapterV1,
  nativeSeriesPackFileAdapterV1,
} from "./native-recovery-phases.ts";
import { seriesPackRoleResult } from "./result.ts";

type Fixture = Awaited<
  ReturnType<typeof createPerEpisodeNativeRecoveryFixtureV1>
>;

/** One disposable role owner, registered before any await. The Node process
 * has only PATH; the actual Network and Files workers receive their own facets. */
export function createNativeSeriesPackRecoveryRoleV1(
  scenario: Fixture,
  environment: TestWorkflowEnvironment,
  charges: { method: string; paid: number }[],
) {
  const workers: Worker[] = [];
  const running: Promise<void>[] = [];
  let nodeWorker: Bun.Subprocess | undefined;
  let directory: string | undefined;
  let current: { workflowId: string; runId: string } | undefined;
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= (async () => {
      const failures: unknown[] = [];
      const settle = async (work: () => Promise<unknown>) => {
        try {
          await work();
        } catch (error) {
          failures.push(error);
        }
      };
      const active = current;
      if (active !== undefined)
        await settle(async () => {
          const handle = environment.client.workflow.getHandle(
            active.workflowId,
            active.runId,
          );
          const actual = await environment.client.connection.withDeadline(
            Date.now() + 20_000,
            () => handle.describe(),
          );
          if (actual.status.name === "RUNNING")
            await environment.client.connection.withDeadline(
              Date.now() + 20_000,
              () => handle.terminate("Exact owned recovery role teardown"),
            );
        });
      for (const worker of workers)
        if (worker.getState() === "RUNNING") worker.shutdown();
      await settle(() => Promise.all(running));
      if (nodeWorker !== undefined) {
        nodeWorker.kill("SIGTERM");
        const owned = nodeWorker;
        await settle(() => owned.exited);
      }
      const ownedDirectory = directory;
      if (ownedDirectory !== undefined)
        await settle(() =>
          rm(ownedDirectory, { recursive: true, force: true }),
        );
      if (failures.length > 0)
        throw new AggregateError(
          failures,
          "Exact native recovery roles did not close",
        );
    })();
    return closing;
  };
  return {
    close,
    async run(
      input: NativeCompensationActivityInput,
      phase: "physical" | "publication",
      caseDeadline: number,
    ) {
      const { node } = pinnedMovieRuntimes();
      directory = await mkdtemp(
        path.join(tmpdir(), "media-native-pack-retry-"),
      );
      const script = new URL(
        "../../../../scripts/media-system/workflow-worker.ts",
        import.meta.url,
      ).pathname;
      const runtimePath = Bun.env["PATH"];
      if (runtimePath === undefined)
        throw new Error("Pinned credentialless runtime PATH missing");
      const childEnvironment = { PATH: runtimePath };
      nodeWorker = await startMovieWorkflowWorker({
        node,
        script,
        address: environment.address,
        directory,
        childEnvironment,
      });
      const network = nativeSeriesPackNetworkAdapterV1(scenario);
      const files = nativeSeriesPackFileAdapterV1(scenario);
      const paid = <T>(method: string, work: () => Promise<T>) =>
        nativeSeriesPackPaidV1(`retry_role_${phase}_${method}`, charges, work);
      workers.push(
        await Worker.create({
          connection: environment.nativeConnection,
          namespace: "dev",
          taskQueue: TASK_QUEUES.MEDIA_NETWORK,
          activities: {
            seriesPackNativeCompensationStateV1: (
              raw: NativeCompensationActivityInput,
            ) =>
              paid("state", () =>
                network.seriesPackNativeCompensationStateV1(raw),
              ),
            observeSeriesPackNativeCompensationExecutionV1: (
              raw: NativeCompensationActivityInput,
            ) =>
              paid("observe", () =>
                network.observeSeriesPackNativeCompensationExecutionV1(raw),
              ),
            publishSeriesPackNativeCompensationV1: (
              raw: NativeCompensationActivityInput,
            ) =>
              paid("publish", () =>
                network.publishSeriesPackNativeCompensationV1(raw),
              ),
            finishMediaOperation: scenario.finishMediaOperation,
          },
        }),
      );
      running.push(...workers.slice(-1).map((worker) => worker.run()));
      if (phase === "physical") {
        workers.push(
          await Worker.create({
            connection: environment.nativeConnection,
            namespace: "dev",
            taskQueue: TASK_QUEUES.MEDIA_FILES,
            activities: {
              compensateSeriesPackNativePublicationV1: (
                raw: NativeCompensationActivityInput,
              ) =>
                paid("files", () =>
                  files.compensateSeriesPackNativePublicationV1(raw),
                ),
            },
          }),
        );
        running.push(...workers.slice(-1).map((worker) => worker.run()));
      }
      const dispatched = await scenario.dispatch(async (start) => {
        if (start.input["operationId"] !== input.operationId)
          throw new Error("Unrelated commands remain for their own workers");
        expect(start.input).toEqual(input);
        const handle = await environment.client.connection.withDeadline(
          Date.now() + 20_000,
          () =>
            environment.client.workflow.start(start.workflowType, {
              workflowId: start.workflowId,
              taskQueue: TASK_QUEUES.WORKFLOWS,
              args: [start.input],
            }),
        );
        current = {
          workflowId: start.workflowId,
          runId: handle.firstExecutionRunId,
        };
      }, caseDeadline);
      expect(dispatched.dispatched).toBe(1);
      const active = current;
      if (active === undefined)
        throw new Error("Actual recovery outbox did not dispatch");
      await seriesPackRoleResult({
        environment,
        workflowId: active.workflowId,
        caseDeadline,
      });
      const handle = environment.client.workflow.getHandle(
        active.workflowId,
        active.runId,
      );
      const completed = await handle.describe();
      expect(completed.status.name).toBe("COMPLETED");
      const operation = await scenario.db.operation.findUniqueOrThrow({
        where: { id: input.operationId },
      });
      expect(operation.status).toBe("completed");
      const history = await handle.fetchHistory();
      assertNativeRecoveryRoleHistoryV1(history, phase);
      const serialized = historyToJSON(history);
      assertPrivateHistory(serialized, [
        "magnet:",
        "/data/tv",
        "/downloads/media",
        "completionRaw",
        "bindingsRaw",
        "encryptedSource",
        "Synthetic.Anime",
      ]);
      const target = path.join(directory, `native-${phase}-retry.json`);
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

function assertNativeRecoveryRoleHistoryV1(
  history: Parameters<typeof historyToJSON>[0],
  phase: "physical" | "publication",
) {
  const methods =
    history.events?.flatMap((event) =>
      event.activityTaskScheduledEventAttributes == null
        ? []
        : [event.activityTaskScheduledEventAttributes],
    ) ?? [];
  expect(methods.map((method) => method.activityType?.name)).toEqual(
    phase === "physical"
      ? [
          "seriesPackNativeCompensationStateV1",
          "observeSeriesPackNativeCompensationExecutionV1",
          "observeSeriesPackNativeCompensationExecutionV1",
          "compensateSeriesPackNativePublicationV1",
          "finishMediaOperation",
        ]
      : [
          "seriesPackNativeCompensationStateV1",
          "publishSeriesPackNativeCompensationV1",
          "finishMediaOperation",
        ],
  );
  for (const method of methods) {
    const file =
      method.activityType?.name === "compensateSeriesPackNativePublicationV1";
    expect(method.taskQueue?.name).toBe(
      file ? TASK_QUEUES.MEDIA_FILES : TASK_QUEUES.MEDIA_NETWORK,
    );
    expect(Number(method.startToCloseTimeout?.seconds?.toString())).toBe(
      file ? 43_200 : 120,
    );
    expect(Number(method.scheduleToCloseTimeout?.seconds?.toString())).toBe(
      file ? 90_000 : 300,
    );
    expect(method.retryPolicy?.maximumAttempts).toBe(2);
    if (file)
      expect(Number(method.heartbeatTimeout?.seconds?.toString())).toBe(60);
  }
}
