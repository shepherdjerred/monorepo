import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Worker } from "@temporalio/worker";
import { WorkflowNotFoundError } from "@temporalio/common";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { expect } from "vitest";
import { z } from "zod";
import type { createPerEpisodeNativeRecoveryFixtureV1 } from "@shepherdjerred/media/testing/per-episode-native-recovery";
import {
  createAcquisitionNetworkWorkerActivities,
  createAcquisitionFileWorkerActivities,
} from "#activities/media/acquisition.ts";
import { createPlexPublicationActivities } from "#activities/media/plex-publication.ts";
import { createPlexBoundConsumerActivities } from "#activities/media/plex-consumers.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  pinnedMovieRuntimes,
  startMovieWorkflowWorker,
} from "#activities/media/testing/role-worker.ts";
import { seriesPackRoleFailureEvidence } from "./failure-evidence.ts";
import { waitForNativeSeriesPackInterruptionV1 } from "./native-recovery-phases.ts";

type Fixture = Awaited<
  ReturnType<typeof createPerEpisodeNativeRecoveryFixtureV1>
>;
const Status = z.enum([
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "TERMINATED",
  "CONTINUED_AS_NEW",
  "TIMED_OUT",
  "PAUSED",
  "UNKNOWN",
  "UNSPECIFIED",
]);

/** Registered synchronously by the test before any startup await. Only the
 * exact created processes/runs are owned; failures still dispose every layer. */
export function createNativeRecoveryPrerequisiteV1(scenario: Fixture) {
  let environment: TestWorkflowEnvironment | undefined;
  let directory: string | undefined;
  let workflow: Bun.Subprocess | undefined;
  const workers: Worker[] = [];
  const running: Promise<void>[] = [];
  const started: string[] = [];
  const dispatchEvidence: {
    candidates?: {
      operationId: string;
      kind: string;
      availableAt: Date;
      dispatchedAt: Date | null;
    }[];
    result?: { dispatched: number; deferred: number };
    attempts: {
      workflowId: string;
      workflowType: string;
      selected: boolean;
      failure?: {
        name?: string | undefined;
        code?: number | string | undefined;
        details?: string | undefined;
      };
    }[];
  } = { attempts: [] };
  let disposed = false;
  const active = () => {
    if (disposed) throw new Error("Native prerequisite already disposed");
  };
  const stopWorkers = async () => {
    for (const worker of workers)
      if (worker.getState() === "RUNNING") worker.shutdown();
    await Promise.all(running);
    workers.length = 0;
    running.length = 0;
  };
  const stopNode = async () => {
    if (workflow !== undefined) {
      workflow.kill("SIGTERM");
      await workflow.exited;
      workflow = undefined;
    }
  };
  const evidence = async () => ({
    dispatch: dispatchEvidence,
    ...(environment === undefined || directory === undefined
      ? { histories: [], logs: [] }
      : await seriesPackRoleFailureEvidence({
          environment,
          workflowIds: started,
          directory,
        })),
  });
  return {
    evidence,
    workflowEnvironment() {
      if (environment === undefined)
        throw new Error("Actual original Temporal environment missing");
      return environment;
    },
    async run() {
      active();
      const caseDeadline = Date.now() + 60_000;
      const { temporal, node } = pinnedMovieRuntimes();
      directory = await mkdtemp(
        path.join(tmpdir(), "media-series-pack-native-recovery-"),
      );
      active();
      const local = await TestWorkflowEnvironment.createLocal({
        server: {
          executable: { type: "existing-path", path: temporal },
          ip: "127.0.0.1",
          namespace: "dev",
          ui: false,
        },
      });
      environment = local;
      active();
      const deadline = <T>(work: () => Promise<T>) =>
        local.client.connection.withDeadline(Date.now() + 20_000, work);
      scenario.bindTemporal({
        describe: async (workflowId) => {
          const actual = await deadline(() =>
            local.client.workflow.getHandle(workflowId).describe(),
          );
          return {
            status: Status.parse(actual.status.name),
            runId: actual.runId,
          };
        },
        stop: async (input) => {
          for (const workflowId of [
            `media-operation-${input.operationId}`,
            `media-acquire-${input.attemptId}`,
          ])
            await stopRecordedRun(local, workflowId);
        },
      });
      const script = new URL(
        "../../../../scripts/media-system/workflow-worker.ts",
        import.meta.url,
      ).pathname;
      const runtimePath = Bun.env["PATH"];
      if (runtimePath === undefined || runtimePath.length === 0)
        throw new Error("Pinned runtime PATH required");
      workflow = await startMovieWorkflowWorker({
        node,
        script,
        address: local.address,
        directory,
        childEnvironment: { PATH: runtimePath },
      });
      active();
      workers.push(
        await Worker.create({
          connection: local.nativeConnection,
          namespace: "dev",
          taskQueue: TASK_QUEUES.MEDIA_NETWORK,
          activities: {
            ...createAcquisitionNetworkWorkerActivities(() =>
              Promise.resolve({ acquisition: scenario.acquisition }),
            ),
            ...createPlexPublicationActivities(() => Promise.resolve(scenario)),
            ...createPlexBoundConsumerActivities(() =>
              Promise.resolve(scenario),
            ),
            finishMediaOperation: scenario.finishMediaOperation,
          },
        }),
      );
      running.push(...workers.slice(-1).map((worker) => worker.run()));
      active();
      workers.push(
        await Worker.create({
          connection: local.nativeConnection,
          namespace: "dev",
          taskQueue: TASK_QUEUES.MEDIA_FILES,
          activities: createAcquisitionFileWorkerActivities(() =>
            Promise.resolve({ acquisition: scenario.fileAcquisition }),
          ),
        }),
      );
      running.push(...workers.slice(-1).map((worker) => worker.run()));
      active();
      dispatchEvidence.candidates = await scenario.db.outboxCommand.findMany({
        where: { dispatchedAt: null },
        take: 30,
        select: {
          operationId: true,
          kind: true,
          availableAt: true,
          dispatchedAt: true,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      dispatchEvidence.result = await scenario.dispatch(async (start) => {
        const attempt: (typeof dispatchEvidence.attempts)[number] = {
          workflowId: start.workflowId,
          workflowType: start.workflowType,
          selected: scenario.roleCommand(start),
        };
        dispatchEvidence.attempts.push(attempt);
        if (!attempt.selected)
          throw new Error("Unrelated initial commands must remain queued");
        expect(start.workflowType).toBe("reconcileMediaWorkflow");
        try {
          await deadline(() =>
            local.client.workflow.start(start.workflowType, {
              workflowId: start.workflowId,
              taskQueue: TASK_QUEUES.WORKFLOWS,
              args: [start.input],
            }),
          );
        } catch (error) {
          attempt.failure = z
            .object({
              name: z.string().optional(),
              code: z.union([z.number(), z.string()]).optional(),
              details: z.string().max(512).optional(),
            })
            .parse(error);
          throw error;
        }
        started.push(start.workflowId);
      });
      const workflowId = started[0];
      if (workflowId === undefined)
        throw new Error("Actual acquisition was not dispatched");
      const interrupted = await waitForNativeSeriesPackInterruptionV1(
        scenario,
        { environment: local, workflowId, caseDeadline },
      );
      await scenario.settled;
      await stopWorkers();
      await stopNode();
      return interrupted;
    },
    async close() {
      disposed = true;
      const errors: unknown[] = [];
      const settle = async (work: () => Promise<unknown>) => {
        try {
          await work();
        } catch (error) {
          errors.push(error);
        }
      };
      const ownedEnvironment = environment;
      const ownedDirectory = directory;
      if (ownedEnvironment !== undefined)
        await settle(() => stopRecordedTree(ownedEnvironment, started));
      await settle(stopWorkers);
      await settle(stopNode);
      if (ownedEnvironment !== undefined)
        await settle(() => ownedEnvironment.teardown());
      if (ownedDirectory !== undefined)
        await settle(() =>
          rm(ownedDirectory, { recursive: true, force: true }),
        );
      if (errors.length > 0)
        throw new AggregateError(
          errors,
          "Owned native prerequisite cleanup failed",
        );
    },
  };
}

async function stopRecordedRun(
  environment: TestWorkflowEnvironment,
  workflowId: string,
) {
  const deadline = <T>(work: () => Promise<T>) =>
    environment.client.connection.withDeadline(Date.now() + 20_000, work);
  const actual = await deadline(() =>
    environment.client.workflow.getHandle(workflowId).describe(),
  );
  if (actual.status.name !== "RUNNING" && actual.status.name !== "PAUSED")
    return;
  const handle = environment.client.workflow.getHandle(
    workflowId,
    actual.runId,
    { followRuns: false },
  );
  try {
    await deadline(() =>
      handle.terminate(
        "Owned disposable native fixture stopped after actual file ACK",
      ),
    );
  } catch (error) {
    if (!(error instanceof WorkflowNotFoundError)) throw error;
    const current = await deadline(() => handle.describe());
    if (
      current.runId !== actual.runId ||
      current.status.name === "RUNNING" ||
      current.status.name === "PAUSED"
    )
      throw error;
  }
}

async function stopRecordedTree(
  environment: TestWorkflowEnvironment,
  roots: readonly string[],
) {
  const ids = [...roots];
  for (const id of roots) {
    const history = await environment.client.connection.withDeadline(
      Date.now() + 20_000,
      () => environment.client.workflow.getHandle(id).fetchHistory(),
    );
    for (const event of history.events ?? []) {
      const child =
        event.childWorkflowExecutionStartedEventAttributes?.workflowExecution
          ?.workflowId;
      if (child != null) ids.push(child);
    }
  }
  if (ids.length > 4)
    throw new Error(
      "Owned native fixture Workflow tree exceeds its real bound",
    );
  for (const id of new Set(ids)) await stopRecordedRun(environment, id);
}
