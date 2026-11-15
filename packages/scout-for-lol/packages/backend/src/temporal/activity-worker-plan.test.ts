import type { ScoutTemporalQueueClass } from "#src/configuration/runtime-role.ts";
import {
  RESERVED_PROBE_SLOTS,
  scoutActivityWorkerPlans,
  type ScoutActivityWorkerGroups,
  type ScoutActivityWorkerPlan,
} from "#src/temporal/activity-worker-plan.ts";
import {
  ScoutQueueCanaryProbeResultSchema,
  assertScoutQueueCanaryProbe,
  scoutQueueCanaryProbeRoutes,
  type ScoutQueueCanaryProbeRoute,
} from "@scout-for-lol/temporal";
import type {
  ScoutQueueCanaryProbeInput,
  ScoutQueueCanaryProbeResult,
} from "@scout-for-lol/temporal/contracts";
import { describe, expect, test } from "vitest";

/**
 * AI-544: the release canary timed out on prod because its background probe
 * waited for the single `scout-prod-background` slot, which real work held.
 *
 * These tests drive the canary's real probe routes
 * (`scoutQueueCanaryProbeRoutes`) against the real worker layout
 * (`scoutActivityWorkerPlans`) on a fake Temporal matcher that honours each
 * worker's slot budget, so the starvation is reproduced rather than asserted.
 */

/**
 * A slot-honouring stand-in for Temporal's matcher: a task waits in FIFO order
 * until a worker on its queue has a free slot. `runningOn` plays the part of
 * the Activity Context's `info.taskQueue`, read synchronously when the
 * Activity starts.
 */
class FakeMatcher {
  readonly #queues = new Map<
    string,
    { free: number; activities: object; waiting: (() => void)[] }
  >();
  runningOn: string | undefined;

  register(plan: ScoutActivityWorkerPlan): void {
    this.#queues.set(plan.taskQueue, {
      free: plan.maxConcurrentActivityTaskExecutions,
      activities: plan.activities,
      waiting: [],
    });
  }

  async dispatch(
    taskQueue: string,
    activityType: string,
    input: unknown,
  ): Promise<unknown> {
    const queue = this.#queues.get(taskQueue);
    if (queue === undefined) {
      return await new Promise<never>(() => {
        // No poller: Temporal holds the task until one arrives.
      });
    }
    if (queue.free === 0) {
      await new Promise<void>((resolve) => queue.waiting.push(resolve));
    } else {
      queue.free -= 1;
    }
    try {
      const activity: unknown = Reflect.get(queue.activities, activityType);
      if (typeof activity !== "function") {
        throw new TypeError(
          `${activityType} is not registered on ${taskQueue}`,
        );
      }
      this.runningOn = taskQueue;
      const outcome: unknown = await Reflect.apply(activity, undefined, [
        input,
      ]);
      return outcome;
    } finally {
      const next = queue.waiting.shift();
      if (next === undefined) queue.free += 1;
      else next();
    }
  }
}

/** Let every already-runnable continuation run. */
async function drainMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

function activityGroups(
  matcher: FakeMatcher,
  backgroundWork: Promise<undefined>,
): ScoutActivityWorkerGroups {
  const probeQueue = (
    input: ScoutQueueCanaryProbeInput,
  ): Promise<ScoutQueueCanaryProbeResult> => {
    const taskQueue = matcher.runningOn;
    if (taskQueue === undefined) throw new Error("No running Activity");
    return Promise.resolve({ ...input, taskQueue });
  };
  // The background worker also runs the real work that holds its one slot.
  const background = {
    probeQueue,
    reconcileIngestion: () => backgroundWork,
  };
  return {
    gateway: { probeQueue },
    realtime: { probeQueue },
    interactive: { probeQueue },
    background,
    lake: { probeQueue },
    crawl: {},
  };
}

const EVERY_ACTIVITY_QUEUE = new Set<ScoutTemporalQueueClass>([
  "interactive",
  "lake",
  "realtime",
  "background",
]);

function runCanaryProbes(
  matcher: FakeMatcher,
  routes: readonly ScoutQueueCanaryProbeRoute[],
): {
  readonly settled: Map<string, ScoutQueueCanaryProbeResult | Error>;
  readonly done: Promise<void>;
} {
  const settled = new Map<string, ScoutQueueCanaryProbeResult | Error>();
  const probes = Promise.all(
    routes.map(async (route) => {
      try {
        const result = ScoutQueueCanaryProbeResultSchema.parse(
          await matcher.dispatch(route.dispatchTaskQueue, "probeQueue", {
            stage: "prod",
            canaryId: "ai-544",
            queueClass: route.queueClass,
          }),
        );
        assertScoutQueueCanaryProbe(route, result);
        settled.set(route.queueClass, result);
      } catch (error: unknown) {
        settled.set(
          route.queueClass,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }),
  );
  const done = (async () => {
    await probes;
  })();
  return { settled, done };
}

function setUp(state: (taskQueue: string) => string | undefined) {
  const matcher = new FakeMatcher();
  const work = Promise.withResolvers<undefined>();
  const plans = scoutActivityWorkerPlans(
    "prod",
    EVERY_ACTIVITY_QUEUE,
    activityGroups(matcher, work.promise),
    state,
  );
  for (const plan of plans) matcher.register(plan);
  // Real background work takes the queue's only slot, as the gateway-ready
  // ingestion reconciliation does right after a step-sync restart.
  const occupying = matcher.dispatch(
    "scout-prod-background",
    "reconcileIngestion",
    { stage: "prod" },
  );
  return { matcher, work, occupying };
}

describe("queue canary against an occupied background slot", () => {
  test("the pre-patch route waits for the work slot and never proves background", async () => {
    const { matcher, work, occupying } = setUp(() => "RUNNING");
    const { settled, done } = runCanaryProbes(
      matcher,
      scoutQueueCanaryProbeRoutes("prod", {
        includeGateway: false,
        reservedProbeSlots: false,
      }),
    );
    await drainMicrotasks();

    expect([...settled.keys()].toSorted()).toEqual([
      "interactive",
      "lake",
      "realtime",
    ]);
    expect(settled.has("background")).toBe(false);

    // Only releasing the real work lets the probe start: the gate measured
    // the slot, not the candidate.
    work.resolve(undefined);
    await Promise.all([occupying, done]);
    expect(settled.get("background")).toMatchObject({
      taskQueue: "scout-prod-background",
    });
  });

  test("the reserved route proves every queue while the work slot stays occupied", async () => {
    const { matcher, work, occupying } = setUp(() => "RUNNING");
    const { settled, done } = runCanaryProbes(
      matcher,
      scoutQueueCanaryProbeRoutes("prod", {
        includeGateway: false,
        reservedProbeSlots: true,
      }),
    );
    await done;

    expect(settled.get("background")).toEqual({
      stage: "prod",
      canaryId: "ai-544",
      queueClass: "background",
      taskQueue: "scout-prod-background",
      probeTaskQueue: "scout-prod-background-probe",
    });
    for (const queueClass of ["realtime", "interactive", "lake"]) {
      expect(settled.get(queueClass)).toMatchObject({
        taskQueue: `scout-prod-${queueClass}`,
        probeTaskQueue: `scout-prod-${queueClass}-probe`,
      });
    }

    work.resolve(undefined);
    await occupying;
  });

  test("the reserved route still fails when the work-queue worker is not running", async () => {
    const { matcher, work, occupying } = setUp((taskQueue) =>
      taskQueue === "scout-prod-background" ? "FAILED" : "RUNNING",
    );
    const { settled, done } = runCanaryProbes(
      matcher,
      scoutQueueCanaryProbeRoutes("prod", {
        includeGateway: false,
        reservedProbeSlots: true,
      }),
    );
    await done;

    const background = settled.get("background");
    expect(background).toBeInstanceOf(Error);
    expect(background).toMatchObject({
      type: "ScoutQueueWorkerNotRunning",
      nonRetryable: true,
    });
    expect(settled.get("realtime")).not.toBeInstanceOf(Error);

    work.resolve(undefined);
    await occupying;
  });

  test("a probe that skipped the reserved queue is refused", () => {
    const [route] = scoutQueueCanaryProbeRoutes("prod", {
      includeGateway: false,
      reservedProbeSlots: true,
    });
    if (route === undefined) throw new Error("No canary route");
    expect(() => {
      assertScoutQueueCanaryProbe(route, {
        stage: "prod",
        canaryId: "ai-544",
        queueClass: route.queueClass,
        taskQueue: route.servedTaskQueue,
      });
    }).toThrow(/probe ran on no reserved queue/);
  });
});

describe("activity worker layout", () => {
  test("each probed work queue keeps its slots and gains a reserved sibling", () => {
    const plans = scoutActivityWorkerPlans(
      "beta",
      new Set<ScoutTemporalQueueClass>([
        "workflow",
        "realtime",
        "background",
        "crawl",
        "gateway",
      ]),
      activityGroups(new FakeMatcher(), Promise.resolve(undefined)),
      () => "RUNNING",
    );
    expect(
      plans.map((plan) => [
        plan.taskQueue,
        plan.maxConcurrentActivityTaskExecutions,
        plan.attestsTaskQueue,
      ]),
    ).toEqual([
      ["scout-beta-gateway", 2, undefined],
      ["scout-beta-realtime", 4, undefined],
      [
        "scout-beta-realtime-probe",
        RESERVED_PROBE_SLOTS,
        "scout-beta-realtime",
      ],
      ["scout-beta-crawl", 1, undefined],
      ["scout-beta-background", 1, undefined],
      [
        "scout-beta-background-probe",
        RESERVED_PROBE_SLOTS,
        "scout-beta-background",
      ],
    ]);
    for (const plan of plans.filter(
      (candidate) => candidate.attestsTaskQueue !== undefined,
    )) {
      expect(Object.keys(plan.activities)).toEqual(["probeQueue"]);
    }
  });
});
