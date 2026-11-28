import { expect, test, vi } from "vitest";
import { ApplicationFailure } from "@temporalio/common";
import type { WorkflowHandle } from "@temporalio/client";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { parseCiMaintenanceHealthMemo } from "#activities/ops/ci-maintenance/ci-maintenance-health.ts";
import {
  buildCiMaintenanceAlerts,
  isFiringAlert,
} from "#shared/alerts/ci-maintenance-alert.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type {
  CiMaintenanceKind,
  MaintenanceObservation,
  MaintenanceRequest,
} from "#shared/ci-maintenance.ts";

const workflowsPath = new URL("../index.ts", import.meta.url).pathname;
const beforePath = new URL(
  "fixtures/ci-maintenance-before-bounded-stalls.ts",
  import.meta.url,
).pathname;
const source = "c".repeat(40);
const clockStart = Date.parse("2026-11-27T04:00:00.000Z");

type FakeWoodpecker = {
  minutes: number;
  receipt: MaintenanceObservation["pending"];
  submitted: MaintenanceRequest[];
  /** What the queue evidence shows when the coordinator checks a long-queued request. */
  queue: "backlog" | "bypassed" | "unconfirmed" | "unreadable";
  checks: MaintenanceRequest[];
  canceled: MaintenanceRequest[];
};

/** Fake Woodpecker with the real inspection's shape and a test-driven clock. */
function fakeMaintenance(kinds: readonly CiMaintenanceKind[]) {
  const world: FakeWoodpecker = {
    minutes: 0,
    receipt: null,
    submitted: [],
    queue: "backlog",
    checks: [],
    canceled: [],
  };
  const activities = {
    inspectCiMaintenance: (
      pending: MaintenanceRequest | null,
    ): MaintenanceObservation => ({
      enabled: true,
      busy: false,
      // The real activity lists candidates only when nothing is pending.
      candidates:
        pending === null
          ? kinds.map((kind) => ({
              kind,
              source,
              fingerprint: `${kind}-v1`,
              frozen: false,
            }))
          : [],
      pending: pending === null ? null : structuredClone(world.receipt),
      observedAt: new Date(clockStart + world.minutes * 60_000).toISOString(),
    }),
    submitCiMaintenance: (request: MaintenanceRequest) => {
      world.submitted.push(request);
      const number = 100 + world.submitted.length;
      world.receipt = { number, status: "pending", source, startedWork: false };
      return number;
    },
    cancelStuckCiMaintenance: (request: MaintenanceRequest) => {
      world.checks.push(request);
      if (world.queue === "unreadable")
        throw new Error("Woodpecker queue HTTP 503");
      if (world.queue === "backlog")
        return {
          outcome: "waiting",
          detail: "40 older pr-pool task(s) are ahead of it in the queue",
        };
      world.canceled.push(request);
      return world.queue === "bypassed"
        ? {
            outcome: "canceled",
            detail:
              "1 newer pr-pool task(s) started ahead of it, so no agent takes it",
          }
        : {
            outcome: "uncertain",
            detail: "cancel returned HTTP 409; still queued",
          };
    },
  };
  const settle = (status: string) => {
    if (world.receipt === null) throw new Error("Nothing was submitted");
    world.receipt = { ...world.receipt, status, startedWork: false };
  };
  return { world, activities, settle };
}

async function startWorkflowWorker(
  environment: TestWorkflowEnvironment,
  path: string,
) {
  const worker = await Worker.create({
    connection: environment.nativeConnection,
    namespace: "default",
    taskQueue: TASK_QUEUES.WORKFLOWS,
    workflowsPath: path,
    // No sticky cache: a swapped-in worker takes the next task at once, and
    // every task replays the whole history, including the pre-patch part.
    maxCachedWorkflows: 0,
  });
  const run = worker.run();
  return async () => {
    worker.shutdown();
    await run;
  };
}

/** Each tick ends with one memo upsert, so upserts count completed ticks. */
function coordinatorDriver(handle: WorkflowHandle) {
  let ticks = 1;
  const awaitTicks = async () => {
    await vi.waitFor(
      async () => {
        const history = await handle.fetchHistory();
        const upserts = (history.events ?? []).filter(
          (event) =>
            event.workflowPropertiesModifiedEventAttributes !== undefined &&
            event.workflowPropertiesModifiedEventAttributes !== null,
        );
        expect(upserts).toHaveLength(ticks);
      },
      { timeout: 30_000, interval: 50 },
    );
    const description = await handle.describe();
    return description.memo?.["ciMaintenance"];
  };
  return {
    started: awaitTicks,
    async tick() {
      ticks++;
      await handle.signal("maintenanceTick");
      return await awaitTicks();
    },
  };
}

async function expectCleanReplay(handle: WorkflowHandle) {
  const history = await handle.fetchHistory();
  const events = history.events ?? [];
  expect(
    events.some(
      (event) =>
        event.workflowTaskFailedEventAttributes !== undefined &&
        event.workflowTaskFailedEventAttributes !== null,
    ),
  ).toBe(false);
  await Worker.runReplayHistory({ workflowsPath }, history);
  return events;
}

test("an upgraded coordinator replays its unbounded retries, then blocks after six more", async () => {
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  const { world, activities, settle } = fakeMaintenance(["workspace-golden"]);
  const activityWorker = await Worker.create({
    connection: environment.nativeConnection,
    namespace: "default",
    taskQueue: TASK_QUEUES.REPO_AUTOMATION,
    activities,
  });
  const activityRun = activityWorker.run();
  const stopBefore = await startWorkflowWorker(environment, beforePath);
  let stopAfter: (() => Promise<void>) | undefined;
  const handle = await environment.client.workflow.start(
    "runCiMaintenanceCoordinator",
    {
      workflowId: `maintenance-upgrade-${crypto.randomUUID()}`,
      taskQueue: TASK_QUEUES.WORKFLOWS,
    },
  );
  try {
    const coordinator = coordinatorDriver(handle);
    await coordinator.started();
    expect(world.submitted).toHaveLength(1);
    // The deployed coordinator retries a pre-work error without bound.
    for (let ending = 1; ending <= 8; ending++) {
      settle("error");
      world.minutes += 5;
      expect(await coordinator.tick()).toMatchObject({
        pending: null,
        blocked: {},
      });
      world.minutes += 5;
      await coordinator.tick();
      expect(world.submitted).toHaveLength(ending + 1);
    }

    // The upgraded worker replays that history, then counts from zero.
    await stopBefore();
    stopAfter = await startWorkflowWorker(environment, workflowsPath);
    for (let ending = 1; ending <= 6; ending++) {
      settle("error");
      world.minutes += 5;
      expect(await coordinator.tick()).toMatchObject({
        pending: null,
        blocked: {},
        preWorkRetries: { "workspace-golden": ending },
        observation: `Pipeline ${String(108 + ending)} ended error before starting work; retry ${String(ending)} of 6 next tick`,
      });
      world.minutes += 5;
      await coordinator.tick();
    }
    expect(world.submitted).toHaveLength(15);
    settle("error");
    world.minutes += 5;
    expect(await coordinator.tick()).toMatchObject({
      pending: null,
      blocked: {
        "workspace-golden": {
          requestId: world.submitted.at(-1)?.requestId,
          reason:
            "Pipeline 115 ended error before starting work after 6 automatic retries; inspect before retrying",
          blockedAt: "2026-11-27T06:25:00.000Z",
        },
      },
      preWorkRetries: {},
    });
    world.minutes += 5;
    await coordinator.tick();
    expect(world.submitted).toHaveLength(15);

    const events = await expectCleanReplay(handle);
    expect(
      events.filter(
        (event) =>
          event.markerRecordedEventAttributes !== undefined &&
          event.markerRecordedEventAttributes !== null,
      ),
    ).toHaveLength(1);
  } finally {
    await handle.terminate("Test complete");
    await (stopAfter ?? stopBefore)();
    activityWorker.shutdown();
    await activityRun;
    await environment.teardown();
  }
}, 120_000);

/** A new-code coordinator with the fake Woodpecker, replayed and torn down afterwards. */
async function withCoordinator(
  kinds: readonly CiMaintenanceKind[],
  run: (input: {
    world: FakeWoodpecker;
    settle: (status: string) => void;
    coordinator: ReturnType<typeof coordinatorDriver>;
    handle: WorkflowHandle;
  }) => Promise<void>,
) {
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  const { world, activities, settle } = fakeMaintenance(kinds);
  const activityWorker = await Worker.create({
    connection: environment.nativeConnection,
    namespace: "default",
    taskQueue: TASK_QUEUES.REPO_AUTOMATION,
    activities,
  });
  const activityRun = activityWorker.run();
  const stop = await startWorkflowWorker(environment, workflowsPath);
  const handle = await environment.client.workflow.start(
    "runCiMaintenanceCoordinator",
    {
      workflowId: `maintenance-${crypto.randomUUID()}`,
      taskQueue: TASK_QUEUES.WORKFLOWS,
    },
  );
  try {
    const coordinator = coordinatorDriver(handle);
    await coordinator.started();
    await run({ world, settle, coordinator, handle });
    await expectCleanReplay(handle);
  } finally {
    await handle.terminate("Test complete");
    await stop();
    activityWorker.shutdown();
    await activityRun;
    await environment.teardown();
  }
}

function clock(world: FakeWoodpecker) {
  return new Date(clockStart + world.minutes * 60_000);
}

/** The occurrences the health check would publish for this memo. */
function firingFor(memo: unknown, at: Date) {
  return buildCiMaintenanceAlerts(
    {
      coordinator: {
        state: parseCiMaintenanceHealthMemo(memo),
        dispatch: "on",
      },
    },
    at,
  )
    .filter((alert) => isFiringAlert(alert))
    .map((alert) =>
      [alert.labels["alertname"], alert.labels["stream"]]
        .filter((part) => part !== undefined)
        .join(":"),
    );
}

test("long backlog: no cancel and the stalled alert fires; bypassed: cancel, and a stream stuck three times blocks", async () => {
  await withCoordinator(["workspace-golden"], async (input) => {
    const { world, settle, coordinator } = input;
    // Behind a FIFO backlog, past the bound: checked every tick, never canceled.
    world.minutes += 125;
    expect(await coordinator.tick()).toMatchObject({
      pending: { pipeline: 101, queuedSince: "2026-11-27T04:00:00.000Z" },
      observation:
        "Pipeline 101 has waited since 2026-11-27T04:00:00.000Z but is not stuck: 40 older pr-pool task(s) are ahead of it in the queue",
    });
    world.minutes += 30;
    const waiting = await coordinator.tick();
    expect(waiting).not.toHaveProperty("pending.cancelRequestedAt");
    expect(world.checks).toHaveLength(2);
    expect(world.canceled).toHaveLength(0);
    expect(waiting).toMatchObject({ pending: { lastQueueCheck: "waiting" } });
    // Behind older work it pages only once it has waited 8 h.
    expect(firingFor(waiting, clock(world))).toEqual([]);
    expect(
      firingFor(waiting, new Date(clockStart + 8.1 * 60 * 60_000)),
    ).toContain("CiMaintenanceRequestStalled");

    // Bypassed by newer work in its pool: canceled once, then rotated.
    for (let round = 1; round <= 3; round++) {
      const pipeline = String(100 + round);
      if (round > 1) {
        // Past the bound but still behind the backlog: no cancel yet.
        world.minutes += 125;
        expect(await coordinator.tick()).not.toHaveProperty(
          "pending.cancelRequestedAt",
        );
      }
      world.queue = "bypassed";
      world.minutes += 5;
      expect(await coordinator.tick()).toMatchObject({
        observation: `Canceled pipeline ${pipeline} because 1 newer pr-pool task(s) started ahead of it, so no agent takes it; awaiting read-back`,
      });
      expect(world.canceled).toHaveLength(round);
      settle("killed");
      world.minutes += 5;
      const settled = await coordinator.tick();
      if (round < 3) {
        expect(settled).toMatchObject({
          pending: null,
          ageOuts: { "workspace-golden": round },
          observation: `Aged out pipeline ${pipeline} after it got stuck in the queue (${String(round)} of 3); rotating to the next stream`,
        });
        world.minutes += 5;
        await coordinator.tick();
        expect(world.submitted).toHaveLength(round + 1);
        world.queue = "backlog";
      } else {
        expect(settled).toMatchObject({
          pending: null,
          blocked: {
            "workspace-golden": {
              reason:
                "Pipeline 103 was aged out of the queue 3 times in a row with evidence it could not run; check its agent pool and labels before retrying",
            },
          },
        });
        // Evaluated 31 minutes on without a tick between, so the silent
        // coordinator pages too.
        expect(
          firingFor(settled, new Date(clock(world).getTime() + 31 * 60_000)),
        ).toEqual([
          "CiMaintenanceStreamBlocked:workspace-golden",
          "CiMaintenanceCoordinatorStalled",
        ]);
      }
    }
    world.minutes += 5;
    await coordinator.tick();
    expect(world.submitted).toHaveLength(3);
  });
}, 120_000);

test("a request stuck in the queue is canceled once and every stream gets a turn", async () => {
  await withCoordinator(
    ["release-notes", "ci-images", "workspace-golden"],
    async ({ world, settle, coordinator }) => {
      world.queue = "bypassed";
      for (let turn = 0; turn < 3; turn++) {
        const request = world.submitted.at(-1);
        if (request === undefined) throw new Error("Nothing was submitted");
        const pipeline = String(101 + turn);
        world.minutes += 60;
        expect(await coordinator.tick()).toMatchObject({
          pending: {
            requestId: request.requestId,
            queuedSince: request.queuedSince,
          },
          observation: `Pipeline ${pipeline} is pending`,
        });
        expect(world.canceled).toHaveLength(turn);

        world.minutes += 60;
        expect(await coordinator.tick()).toMatchObject({
          pending: {
            requestId: request.requestId,
            cancelRequestedAt: clock(world).toISOString(),
          },
        });
        // Still queued after the cancel: never cancel again, wait for read-back.
        world.minutes += 5;
        await coordinator.tick();
        expect(world.canceled.map((canceled) => canceled.requestId)).toEqual(
          world.submitted.slice(0, turn + 1).map((sent) => sent.requestId),
        );

        settle("killed");
        world.minutes += 5;
        expect(await coordinator.tick()).toMatchObject({
          pending: null,
          blocked: {},
        });
        world.minutes += 5;
        await coordinator.tick();
        expect(world.submitted).toHaveLength(turn + 2);
      }
      // Round-robin: an aged-out stream waits for every other stream's turn.
      expect(world.submitted.map((request) => request.kind)).toEqual([
        "workspace-golden",
        "release-notes",
        "ci-images",
        "workspace-golden",
      ]);
      expect(await coordinator.tick()).not.toHaveProperty("preWorkRetries");
    },
  );
}, 120_000);

test("an unconfirmed cancel is never sent again; a check that failed before any cancel runs again", async () => {
  await withCoordinator(["ci-images"], async ({ world, coordinator }) => {
    world.queue = "unreadable";
    world.minutes += 125;
    expect(await coordinator.tick()).toMatchObject({
      observation:
        "Could not check whether pipeline 101 is stuck; checking again next tick",
    });
    const failed = await coordinator.tick();
    expect(failed).not.toHaveProperty("pending.cancelRequestedAt");
    expect(failed).toMatchObject({ pending: { lastQueueCheck: "failed" } });
    expect(world.checks).toHaveLength(2);
    // A failing check pages at 2.5 h; a backlog would not until 8 h.
    expect(firingFor(failed, new Date(clockStart + 153 * 60_000))).toEqual([
      "CiMaintenanceRequestStalled",
    ]);

    world.queue = "unconfirmed";
    world.minutes += 5;
    expect(await coordinator.tick()).toMatchObject({
      pending: { cancelRequestedAt: clock(world).toISOString() },
      observation:
        "Cancel of pipeline 101 is unconfirmed (cancel returned HTTP 409; still queued); awaiting read-back without another cancel",
    });
    for (let tick = 0; tick < 3; tick++) {
      world.minutes += 5;
      await coordinator.tick();
    }
    expect(world.checks).toHaveLength(3);
    expect(world.canceled).toHaveLength(1);
  });
}, 120_000);

test("a tick publishes health beside the wake, tolerates an unregistered health activity, and a pre-patch tick replays", async () => {
  const environment = await TestWorkflowEnvironment.createTimeSkipping();
  const calls: string[] = [];
  let health: "ok" | "fails" | "unregistered" = "ok";
  const connection = {
    connection: environment.nativeConnection,
    namespace: "default",
  };
  // A Worker runs once, so every tick gets its own three workers.
  const runTick = async (path: string) => {
    const repo = await Worker.create({
      ...connection,
      taskQueue: TASK_QUEUES.REPO_AUTOMATION,
      activities: {
        wakeCiMaintenance: () => {
          calls.push("wake");
        },
      },
    });
    const ops = await Worker.create({
      ...connection,
      taskQueue: TASK_QUEUES.OPS,
      activities:
        health === "unregistered"
          ? { collectOpsTemporal: () => ({ signals: [] }) }
          : {
              publishCiMaintenanceHealth: () => {
                calls.push("health");
                if (health === "fails")
                  throw ApplicationFailure.nonRetryable(
                    "Alertmanager POST failed",
                  );
                return { firing: [], unknown: [] };
              },
            },
    });
    const workflows = await Worker.create({
      ...connection,
      taskQueue: TASK_QUEUES.WORKFLOWS,
      workflowsPath: path,
    });
    const workflowId = `maintenance-tick-${crypto.randomUUID()}`;
    const result = workflows.runUntil(
      repo.runUntil(
        ops.runUntil(
          environment.client.workflow.execute("runCiMaintenanceTick", {
            workflowId,
            taskQueue: TASK_QUEUES.WORKFLOWS,
          }),
        ),
      ),
    );
    return { workflowId, result };
  };
  const replay = async (workflowId: string) => {
    await Worker.runReplayHistory(
      { workflowsPath },
      await environment.client.workflow.getHandle(workflowId).fetchHistory(),
    );
  };
  try {
    const before = await runTick(beforePath);
    await before.result;
    expect(calls).toEqual(["wake"]);
    await replay(before.workflowId);

    calls.length = 0;
    const after = await runTick(workflowsPath);
    await after.result;
    expect(calls.toSorted()).toEqual(["health", "wake"]);
    await replay(after.workflowId);

    // An out-of-order rollout: the ops worker does not register it yet.
    calls.length = 0;
    health = "unregistered";
    const early = await runTick(workflowsPath);
    await early.result;
    expect(calls).toEqual(["wake"]);
    await replay(early.workflowId);

    // Any other failed publish fails the tick, which temporal-failure-watch reports.
    calls.length = 0;
    health = "fails";
    const failing = await runTick(workflowsPath);
    await expect(failing.result).rejects.toThrow();
    expect(calls.toSorted()).toEqual(["health", "wake"]);
  } finally {
    await environment.teardown();
  }
}, 120_000);
