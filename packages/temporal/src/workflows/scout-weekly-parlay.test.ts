import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker, type WorkerOptions } from "@temporalio/worker";
import type { WeeklyParlayControlAction as ScoutWeeklyParlayAction } from "@scout-for-lol/data/model/weekly-parlay.ts";
import {
  buildScoutWeeklyParlayCatchupTimeline,
  type ScoutWeeklyParlayTimeline,
} from "#activities/scout-weekly-parlay.ts";
import {
  runScoutWeeklyParlayCatchupWorkflow,
  runScoutWeeklyParlayWorkflow,
} from "./scout-weekly-parlay.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const EMBEDDED_ACTIVITY_QUEUE = "scout-beta-background";
const TASK_QUEUE = EMBEDDED_ACTIVITY_QUEUE;
const TIMELINE: ScoutWeeklyParlayTimeline = {
  periodKey: "2027-03-08",
  openAt: "2027-03-07T20:00:00.000Z",
  reminderAt: "2027-03-08T03:00:00.000Z",
  startsAt: "2027-03-08T08:00:00.000Z",
  updatesAt: [
    "2027-03-09T03:00:00.000Z",
    "2027-03-10T03:00:00.000Z",
    "2027-03-11T03:00:00.000Z",
    "2027-03-12T03:00:00.000Z",
    "2027-03-13T03:00:00.000Z",
    "2027-03-14T03:00:00.000Z",
  ],
  finalizesAt: "2027-03-14T18:00:00.000Z",
};

let testEnvironment: TestWorkflowEnvironment;

type WeeklyParlayWorkers = {
  workflow: Worker;
  scoutActivities: Worker;
  embeddedActivities: Worker;
};

async function weeklyParlayWorkers(
  activities: NonNullable<WorkerOptions["activities"]>,
): Promise<WeeklyParlayWorkers> {
  const [workflow, scoutActivities, embeddedActivities] = await Promise.all([
    Worker.create({
      connection: testEnvironment.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: new URL("index.ts", import.meta.url).pathname,
    }),
    Worker.create({
      connection: testEnvironment.nativeConnection,
      taskQueue: TASK_QUEUES.SCOUT,
      activities,
    }),
    Worker.create({
      connection: testEnvironment.nativeConnection,
      taskQueue: EMBEDDED_ACTIVITY_QUEUE,
      activities,
    }),
  ]);
  return { workflow, scoutActivities, embeddedActivities };
}

async function runWithWeeklyParlayWorkers<T>(
  workers: WeeklyParlayWorkers,
  result: Promise<T>,
): Promise<T> {
  const scoutActivitiesRun = workers.scoutActivities.run();
  const embeddedActivitiesRun = workers.embeddedActivities.run();
  try {
    return await workers.workflow.runUntil(result);
  } finally {
    workers.scoutActivities.shutdown();
    workers.embeddedActivities.shutdown();
    await Promise.all([scoutActivitiesRun, embeddedActivitiesRun]);
  }
}

async function runWeeklyParlayTestWorkflow(
  workers: WeeklyParlayWorkers,
  workflowIdPrefix: string,
): Promise<void> {
  await runWithWeeklyParlayWorkers(
    workers,
    testEnvironment.client.workflow.execute(runScoutWeeklyParlayWorkflow, {
      args: [{}],
      taskQueue: TASK_QUEUE,
      workflowId: `${workflowIdPrefix}-${crypto.randomUUID()}`,
    }),
  );
}

beforeEach(async () => {
  testEnvironment = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterEach(async () => {
  await testEnvironment.teardown();
});

describe("runScoutWeeklyParlayWorkflow", () => {
  test("runs the frozen standard open, reminder, start, updates, and final action sequence", async () => {
    const actions: ScoutWeeklyParlayAction[] = [];
    let timelineAnchor: string | undefined;
    const workers = await weeklyParlayWorkers({
      resolveScoutWeeklyParlayTimeline: (scheduledStartAt: string) => {
        timelineAnchor = scheduledStartAt;
        return TIMELINE;
      },
      invokeScoutWeeklyParlayAction: (action: ScoutWeeklyParlayAction) => {
        actions.push(action);
        return { status: "reconciled", detail: action.action };
      },
    });

    const handle = await testEnvironment.client.workflow.start(
      runScoutWeeklyParlayWorkflow,
      {
        args: [{ slot: 2 }],
        taskQueue: TASK_QUEUE,
        workflowId: `scout-weekly-parlay-${crypto.randomUUID()}`,
      },
    );
    await runWithWeeklyParlayWorkers(workers, handle.result());

    const description = await handle.describe();
    expect(timelineAnchor).toBe(description.startTime.toISOString());
    expect(actions).toEqual([
      { periodKey: TIMELINE.periodKey, slot: 2, action: "open" },
      { periodKey: TIMELINE.periodKey, slot: 2, action: "reminder" },
      { periodKey: TIMELINE.periodKey, slot: 2, action: "start" },
      ...TIMELINE.updatesAt.map((_, updateIndex) => ({
        periodKey: TIMELINE.periodKey,
        slot: 2,
        action: "progress" as const,
        updateIndex,
      })),
      { periodKey: TIMELINE.periodKey, slot: 2, action: "finalize" },
    ]);
  }, 30_000);

  test("runs a frozen catch-up timeline and rejects a duplicate workflow ID", async () => {
    const actions: ScoutWeeklyParlayAction[] = [];
    let timelineAnchor: string | undefined;
    let catchupTimeline: ScoutWeeklyParlayTimeline | undefined;

    // Advance the time-skipping environment's SIMULATED clock to a fixed
    // instant deep in the future before starting the workflow, rather than
    // hardcoding absolute timestamps or deriving them from real wall-clock
    // Date.now(). Two independent fixes for the same underlying bug landed
    // here previously and both had gaps this closes:
    //  - A hardcoded literal finalizesAt broke permanently once real time
    //    crossed it: reconcileStartUntilFinalization only reconciles the
    //    "start" action while `Date.now() < finalizesAt`.
    //  - Deriving openAt/startsAt/finalizesAt from Date.now() fixed that,
    //    but produced a periodKey/window that could never occur in
    //    production: buildScoutWeeklyParlayCatchupTimeline requires
    //    periodKey to be a Monday and finalizesAt to be that period's
    //    standard Sunday finalization enforced by the timeline builder.
    // testEnvironment.sleep() advances the simulated clock only — it
    // resolves immediately regardless of how far ahead the target is — so
    // anchoring to a fixed future instant costs nothing and never drifts
    // back into the past.
    const periodKey = "2027-03-08"; // a Monday; matches TIMELINE above
    // Late enough in the period that no progress updates remain — validated
    // against buildScoutWeeklyParlayCatchupTimeline directly (see this
    // commit's PR description) rather than guessed.
    const workflowStartAt = new Date("2027-03-13T02:00:00.000Z");
    const currentTimeMs = await testEnvironment.currentTimeMs();
    const sleepMs = workflowStartAt.getTime() - currentTimeMs;
    if (sleepMs > 0) {
      await testEnvironment.sleep(sleepMs);
    }
    const workers = await weeklyParlayWorkers({
      resolveScoutWeeklyParlayCatchupTimeline: (workflowStartAtArg: string) => {
        timelineAnchor = workflowStartAtArg;
        // Use the real production builder (the actual
        // resolveScoutWeeklyParlayCatchupTimeline activity is a thin
        // wrapper around it) so this fixture can never drift from the
        // Monday/Sunday contract it must satisfy in production.
        catchupTimeline = buildScoutWeeklyParlayCatchupTimeline(
          workflowStartAtArg,
          periodKey,
        );
        return catchupTimeline;
      },
      invokeScoutWeeklyParlayAction: (action: ScoutWeeklyParlayAction) => {
        actions.push(action);
        return { status: "reconciled", detail: action.action };
      },
    });

    const catchupWorkflowId = `scout-weekly-parlay-catchup-${periodKey}-3`;
    const catchupHandle = await testEnvironment.client.workflow.start(
      runScoutWeeklyParlayCatchupWorkflow,
      {
        args: [{ periodKey, slot: 3 }],
        taskQueue: TASK_QUEUE,
        workflowId: catchupWorkflowId,
      },
    );
    await expect(
      testEnvironment.client.workflow.start(
        runScoutWeeklyParlayCatchupWorkflow,
        {
          args: [{ periodKey, slot: 3 }],
          taskQueue: TASK_QUEUE,
          workflowId: catchupWorkflowId,
        },
      ),
    ).rejects.toThrow();
    await runWithWeeklyParlayWorkers(workers, catchupHandle.result());

    if (catchupTimeline === undefined) {
      throw new Error("Catch-up timeline was never resolved");
    }
    const resolvedTimeline = catchupTimeline;

    const description = await catchupHandle.describe();
    expect(timelineAnchor).toBe(description.startTime.toISOString());
    expect(actions).toEqual([
      {
        periodKey,
        slot: 3,
        action: "open",
        window: {
          kind: "catch_up",
          openAt: resolvedTimeline.openAt,
          bettingClosesAt: resolvedTimeline.startsAt,
          scoringStartsAt: resolvedTimeline.startsAt,
          scoringEndsAt: resolvedTimeline.finalizesAt,
        },
      },
      ...(resolvedTimeline.reminderAt === undefined
        ? []
        : [{ periodKey, slot: 3, action: "reminder" as const }]),
      { periodKey, slot: 3, action: "start" },
      ...resolvedTimeline.updatesAt.map((_, updateIndex) => ({
        periodKey,
        slot: 3,
        action: "progress" as const,
        updateIndex,
      })),
      { periodKey, slot: 3, action: "finalize" },
    ]);
  }, 30_000);

  test("retries scoring start beyond the activity budget and continues after delivery failures", async () => {
    const actions: ScoutWeeklyParlayAction[] = [];
    let startAttempts = 0;
    const workers = await weeklyParlayWorkers({
      resolveScoutWeeklyParlayTimeline: () => TIMELINE,
      invokeScoutWeeklyParlayAction: (action: ScoutWeeklyParlayAction) => {
        actions.push(action);
        if (
          action.action === "reminder" ||
          (action.action === "progress" && action.updateIndex === 2)
        ) {
          throw new Error(`unavailable during ${action.action}`);
        }
        if (action.action === "start") {
          startAttempts += 1;
          if (startAttempts <= 7) {
            throw new Error("unavailable during start");
          }
        }
        return { status: "reconciled", detail: action.action };
      },
    });

    await runWeeklyParlayTestWorkflow(workers, "scout-weekly-parlay-failures");

    expect(actions.at(-1)).toEqual({
      periodKey: TIMELINE.periodKey,
      slot: 0,
      action: "finalize",
    });
    expect(
      actions.filter((action) => action.action === "reminder"),
    ).toHaveLength(5);
    expect(actions.filter((action) => action.action === "start")).toHaveLength(
      8,
    );
    expect(
      actions.filter(
        (action) => action.action === "progress" && action.updateIndex === 2,
      ),
    ).toHaveLength(5);
  }, 30_000);

  test("retries finalization beyond the activity budget until reconciliation succeeds", async () => {
    const actions: ScoutWeeklyParlayAction[] = [];
    let finalizationAttempts = 0;
    const workers = await weeklyParlayWorkers({
      resolveScoutWeeklyParlayTimeline: () => TIMELINE,
      invokeScoutWeeklyParlayAction: (action: ScoutWeeklyParlayAction) => {
        actions.push(action);
        if (action.action === "finalize") {
          finalizationAttempts += 1;
          if (finalizationAttempts <= 5) {
            throw new Error("unavailable during finalization");
          }
          if (finalizationAttempts <= 7) {
            return { status: "skipped", detail: "not_finalized" };
          }
        }
        return { status: "reconciled", detail: action.action };
      },
    });

    await runWeeklyParlayTestWorkflow(workers, "scout-weekly-parlay-finalize");

    expect(
      actions.filter((action) => action.action === "finalize"),
    ).toHaveLength(8);
  }, 30_000);
});
