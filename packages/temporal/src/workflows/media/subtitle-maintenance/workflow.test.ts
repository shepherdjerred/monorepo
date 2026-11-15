import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker, type WorkerOptions } from "@temporalio/worker";
import type { WorkflowHandle } from "@temporalio/client";
import { CancelledFailure } from "@temporalio/common";
import { expect, test } from "vitest";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type { SubtitleMaintenanceJobV1 } from "@shepherdjerred/media/subtitle-maintenance";
import type { MediaNetworkActivities } from "@shepherdjerred/media/automation";

const workflowsPath = new URL("workflow.ts", import.meta.url).pathname;
const job: SubtitleMaintenanceJobV1 = {
  operationId: "6f2a44d9-c9fa-48e7-a38b-28259a7aa49d",
  assetId: "d4d278d7-36a0-4110-8722-ad02db650a2a",
  language: "en",
  forced: false,
  recoveryEpoch: 0,
  targetAuthority: "a".repeat(64),
};
type Activities = NonNullable<WorkerOptions["activities"]>;
type Finished = Parameters<MediaNetworkActivities["finishMediaOperation"]>[0];

async function withWorkers(
  networkActivities: Activities,
  fileActivities: Activities,
  run: (environment: TestWorkflowEnvironment) => Promise<void>,
) {
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  const running: { worker: Worker; result: Promise<void> }[] = [];
  try {
    for (const [taskQueue, activities] of [
      [TASK_QUEUES.MEDIA_NETWORK, networkActivities],
      [TASK_QUEUES.MEDIA_FILES, fileActivities],
    ] as const) {
      const worker = await Worker.create({
        connection: environment.nativeConnection,
        taskQueue,
        activities,
      });
      running.push({ worker, result: worker.run() });
    }
    const workflow = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowsPath,
    });
    await workflow.runUntil(() => run(environment));
  } finally {
    for (const { worker } of running)
      if (worker.getState() === "RUNNING") worker.shutdown();
    try {
      await Promise.all(running.map(({ result }) => result));
    } finally {
      await environment.teardown();
    }
  }
}

function networkForJobs(
  jobs: SubtitleMaintenanceJobV1[],
  find: MediaNetworkActivities["findMediaSubtitles"],
  finished: Finished[],
) {
  return {
    listSubtitleMaintenanceV1: async () => ({
      assetIds: jobs.map((item) => item.assetId),
      nextCursor: null,
    }),
    prepareSubtitleMaintenanceV1: async (input: { assetId: string }) =>
      jobs.filter((item) => item.assetId === input.assetId),
    findMediaSubtitles: find,
    finishMediaOperation: async (input: Finished) => {
      finished.push(input);
    },
  };
}

function speechAndInstall(observed: string[], blocked = false) {
  return {
    prepareSubtitleSpeechV1: async (input: { operationId: string }) => {
      observed.push(`measure:${input.operationId}`);
      return { status: blocked ? "blocked" : "prepared" };
    },
    installMediaSubtitles: async (input: { operationId: string }) => {
      observed.push(`install:${input.operationId}`);
      return { status: "installed" };
    },
  };
}

function startPlanner(environment: TestWorkflowEnvironment) {
  return environment.client.workflow.start("maintainMediaSubtitlesV1Workflow", {
    workflowId: crypto.randomUUID(),
    taskQueue: TASK_QUEUES.WORKFLOWS,
    args: [{ mode: "wanted" }],
  });
}

function childHandle(
  environment: TestWorkflowEnvironment,
  selected: SubtitleMaintenanceJobV1,
) {
  return environment.client.workflow.getHandle(
    `media-operation-${selected.operationId}`,
  );
}

async function replay(...handles: WorkflowHandle[]) {
  for (const handle of handles)
    await Worker.runReplayHistory(
      { workflowsPath },
      await handle.fetchHistory(),
    );
}

test.each([false, true])(
  "actual maintenance job measures speech before install, blocked=%s, and both histories replay",
  async (blocked) => {
    const observed: string[] = [];
    const finished: Finished[] = [];
    await withWorkers(
      networkForJobs(
        [job],
        async () => {
          observed.push("find");
          return { status: "found", subtitleId: "candidate", reason: null };
        },
        finished,
      ),
      speechAndInstall(observed, blocked),
      async (environment) => {
        const parent = await startPlanner(environment);
        await parent.result();
        const child = childHandle(environment, job);
        await child.result();
        expect(observed).toEqual([
          "find",
          `measure:${job.operationId}`,
          ...(blocked ? [] : [`install:${job.operationId}`]),
        ]);
        expect(finished).toEqual([
          {
            operationId: job.operationId,
            status: "completed",
            reason: blocked ? "subtitle_speech_requires_review" : null,
          },
        ]);
        await replay(parent, child);
      },
    );
  },
  60_000,
);

test("a pending first job cannot block the next asset and survives planner continuation and completion", async () => {
  const ready = {
    ...job,
    operationId: crypto.randomUUID(),
    assetId: crypto.randomUUID(),
  };
  const entered = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const observed: string[] = [];
  const finished: Finished[] = [];
  const activities = networkForJobs(
    [job, ready],
    async (input) => {
      if (input.operationId === job.operationId) {
        entered.resolve(undefined);
        await release.promise;
      }
      return { status: "found", subtitleId: "candidate", reason: null };
    },
    finished,
  );
  await withWorkers(
    {
      ...activities,
      listSubtitleMaintenanceV1: async (input: { cursor: string | null }) =>
        input.cursor === null
          ? { assetIds: [job.assetId, ready.assetId], nextCursor: "next" }
          : { assetIds: [], nextCursor: null },
    },
    speechAndInstall(observed),
    async (environment) => {
      try {
        const parent = await startPlanner(environment);
        await parent.result();
        await entered.promise;
        const pending = childHandle(environment, job);
        const next = childHandle(environment, ready);
        await next.result();
        expect(finished.map((item) => item.operationId)).toEqual([
          ready.operationId,
        ]);
        const pendingDescription = await pending.describe();
        expect(pendingDescription.status.name).toBe("RUNNING");
        release.resolve(undefined);
        await pending.result();
        expect(finished.map((item) => item.operationId)).toEqual([
          ready.operationId,
          job.operationId,
        ]);
        const firstRun = environment.client.workflow.getHandle(
          parent.workflowId,
          parent.firstExecutionRunId,
        );
        const firstDescription = await firstRun.describe();
        expect(firstDescription.status.name).toBe("CONTINUED_AS_NEW");
        await replay(firstRun, parent, pending, next);
      } finally {
        release.resolve(undefined);
      }
    },
  );
}, 60_000);

test("repeat plans preserve the same active job and never revive its completed execution", async () => {
  const entered = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const observed: string[] = [];
  const finished: Finished[] = [];
  let searches = 0;
  await withWorkers(
    networkForJobs(
      [job],
      async () => {
        searches++;
        entered.resolve(undefined);
        await release.promise;
        return { status: "found", subtitleId: "candidate", reason: null };
      },
      finished,
    ),
    speechAndInstall(observed),
    async (environment) => {
      try {
        const first = await startPlanner(environment);
        await first.result();
        await entered.promise;
        const child = childHandle(environment, job);
        const original = await child.describe();
        const originalRun = original.runId;
        const second = await startPlanner(environment);
        await second.result();
        const secondDescription = await child.describe();
        expect(secondDescription.runId).toBe(originalRun);
        expect(searches).toBe(1);
        expect(finished).toEqual([]);
        release.resolve(undefined);
        await child.result();
        const third = await startPlanner(environment);
        await third.result();
        const thirdDescription = await child.describe();
        expect(thirdDescription.runId).toBe(originalRun);
        expect(searches).toBe(1);
        expect(observed).toEqual([
          `measure:${job.operationId}`,
          `install:${job.operationId}`,
        ]);
        expect(finished).toHaveLength(1);
        await replay(first, second, third, child);
      } finally {
        release.resolve(undefined);
      }
    },
  );
}, 60_000);

test("cancelling a planner leaves its already-started job running", async () => {
  const entered = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const plannerEntered = Promise.withResolvers<undefined>();
  const releasePlanner = Promise.withResolvers<undefined>();
  const observed: string[] = [];
  const finished: Finished[] = [];
  const plannerGate = crypto.randomUUID();
  const activities = networkForJobs(
    [job],
    async () => {
      entered.resolve(undefined);
      await release.promise;
      return { status: "found", subtitleId: "candidate", reason: null };
    },
    finished,
  );
  await withWorkers(
    {
      ...activities,
      listSubtitleMaintenanceV1: async () => ({
        assetIds: [job.assetId, plannerGate],
        nextCursor: null,
      }),
      prepareSubtitleMaintenanceV1: async (input: { assetId: string }) => {
        if (input.assetId !== plannerGate)
          return activities.prepareSubtitleMaintenanceV1(input);
        plannerEntered.resolve(undefined);
        await releasePlanner.promise;
        return [];
      },
    },
    speechAndInstall(observed),
    async (environment) => {
      try {
        const parent = await startPlanner(environment);
        await plannerEntered.promise;
        await entered.promise;
        const child = childHandle(environment, job);
        await parent.cancel();
        await expect(parent.result()).rejects.toMatchObject({
          cause: expect.any(CancelledFailure),
        });
        const childDescription = await child.describe();
        expect(childDescription.status.name).toBe("RUNNING");
        release.resolve(undefined);
        await child.result();
        expect(finished.map((item) => item.operationId)).toEqual([
          job.operationId,
        ]);
        await replay(parent, child);
      } finally {
        release.resolve(undefined);
        releasePlanner.resolve(undefined);
      }
    },
  );
}, 60_000);
