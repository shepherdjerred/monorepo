import { Context } from "@temporalio/activity";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { expect, test } from "vitest";
import {
  createMediaWorkflowTestWorker,
  drainMediaWorkflowTestWorkers,
} from "#activities/media/testing/workflow-workers.ts";
import { assertScopedMovieActivityBudgets } from "#activities/media/testing/history.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const current = new URL("acquisition.ts", import.meta.url).pathname;
const retained = new URL(
  "acquisition-before-preparation.fixture.ts",
  import.meta.url,
).pathname;

function currentExecution() {
  const execution = Context.current().info.workflowExecution;
  if (execution === undefined)
    throw new Error("Workflow Activity omitted its execution identity");
  return execution;
}

async function run(
  mode: "acquire" | "obsolete" | "empty",
  workflowsPath = current,
) {
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  const mediaId = crypto.randomUUID();
  const input = {
    schemaVersion: 4,
    operationId: crypto.randomUUID(),
    mediaId,
    generation: 1,
    scope: { rootMediaId: mediaId, mediaId, edition: "default" },
  };
  const attemptId = crypto.randomUUID();
  const runIds = new Set<string>();
  const childExecutions: { workflowId: string; runId: string }[] = [];
  const finish: unknown[] = [];
  let searches = 0,
    submissions = 0;
  const network = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue: TASK_QUEUES.MEDIA_NETWORK,
    activities: {
      reconcileMovieIntentV4: (raw: unknown) => {
        expect(raw).toEqual(input);
        runIds.add(currentExecution().runId);
        searches++;
        if (mode !== "empty" && searches === 1)
          return Promise.resolve({
            status: "waiting",
            attemptId: null,
            reason: "provider_deferred",
            retryAfterSeconds: 30,
          });
        return Promise.resolve(
          mode === "acquire"
            ? { status: "acquire", attemptId, reason: null }
            : {
                status: mode === "obsolete" ? "obsolete" : "waiting",
                attemptId: null,
                reason:
                  mode === "obsolete"
                    ? "intent_changed"
                    : "no_acceptable_release",
              },
        );
      },
      submitMovieTorrentV4: (raw: unknown) => {
        childExecutions.push(currentExecution());
        expect(raw).toEqual({
          schemaVersion: 4,
          operationId: input.operationId,
          attemptId,
          scope: input.scope,
        });
        submissions++;
        return Promise.resolve({
          status: "blocked",
          reason: "download_quota_exhausted",
        });
      },
      finishMediaOperation: (raw: unknown) => {
        finish.push(raw);
        return Promise.resolve();
      },
    },
  });
  const workflow = await createMediaWorkflowTestWorker(
    environment,
    workflowsPath,
  );
  const running = network.run();
  try {
    const handle = await environment.client.workflow.start(
      "reconcileMovieEditionV4Workflow",
      {
        workflowId: crypto.randomUUID(),
        taskQueue: TASK_QUEUES.WORKFLOWS,
        args: [input],
      },
    );
    const result: unknown = await workflow.runUntil(handle.result());
    const histories = [];
    for (const runId of runIds) {
      const history = await environment.client.workflow
        .getHandle(handle.workflowId, runId)
        .fetchHistory();
      assertScopedMovieActivityBudgets(history);
      await Worker.runReplayHistory({ workflowsPath: current }, history);
      histories.push(history);
    }
    for (const execution of childExecutions) {
      const history = await environment.client.workflow
        .getHandle(execution.workflowId, execution.runId)
        .fetchHistory();
      assertScopedMovieActivityBudgets(history);
      await Worker.runReplayHistory({ workflowsPath: current }, history);
    }
    return { result, input, searches, submissions, finish, histories };
  } finally {
    await drainMediaWorkflowTestWorkers(environment, [
      { worker: network, running },
    ]);
  }
}

test("local admission waits durably then continues the same operation into one child without retrying terminal quota", async () => {
  const result = await run("acquire");
  expect(result.result).toEqual({
    status: "blocked",
    reason: "download_quota_exhausted",
  });
  expect(result.searches).toBe(2);
  expect(result.submissions).toBe(1);
  expect(result.histories).toHaveLength(2);
  const [deferred, resumed] = result.histories;
  expect(
    deferred?.events
      ?.filter((event) => event.timerStartedEventAttributes)
      .map((event) =>
        Number(
          event.timerStartedEventAttributes?.startToFireTimeout?.seconds?.toString(),
        ),
      ),
  ).toEqual([30]);
  expect(
    deferred?.events?.some(
      (event) => event.workflowExecutionContinuedAsNewEventAttributes != null,
    ),
  ).toBe(true);
  expect(
    deferred?.events?.some(
      (event) =>
        event.startChildWorkflowExecutionInitiatedEventAttributes != null,
    ),
  ).toBe(false);
  expect(
    resumed?.events?.filter(
      (event) => event.startChildWorkflowExecutionInitiatedEventAttributes,
    ),
  ).toHaveLength(1);
  expect(result.finish).toEqual([
    {
      operationId: result.input.operationId,
      status: "reconciling",
      reason: "download_quota_exhausted",
    },
  ]);
}, 60_000);

test("a deferred movie rereads canceled intent and stops without a child or submission", async () => {
  const result = await run("obsolete");
  expect(result.result).toEqual({
    status: "obsolete",
    reason: "intent_changed",
  });
  expect(result.searches).toBe(2);
  expect(result.submissions).toBe(0);
  expect(result.histories).toHaveLength(2);
  expect(
    result.histories.every(
      (history) =>
        !history.events?.some(
          (event) =>
            event.startChildWorkflowExecutionInitiatedEventAttributes != null,
        ),
    ),
  ).toBe(true);
  expect(result.finish).toEqual([
    {
      operationId: result.input.operationId,
      status: "completed",
      reason: "intent_changed",
    },
  ]);
}, 60_000);

test.each([current, retained])(
  "genuine no-results completes once without a deferral timer and its recorded history replays: %s",
  async (workflowsPath) => {
    const result = await run("empty", workflowsPath);
    expect(result.result).toEqual({
      status: "waiting",
      reason: "no_acceptable_release",
    });
    expect(result.searches).toBe(1);
    expect(result.submissions).toBe(0);
    expect(result.histories).toHaveLength(1);
    expect(
      result.histories[0]?.events?.some(
        (event) => event.timerStartedEventAttributes != null,
      ),
    ).toBe(false);
    expect(result.finish).toEqual([
      {
        operationId: result.input.operationId,
        status: "completed",
        reason: "no_acceptable_release",
      },
    ]);
  },
  60_000,
);
