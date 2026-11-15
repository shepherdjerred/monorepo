import type { ScoutTemporalQueueClass } from "#src/configuration/runtime-role.ts";
import {
  ScoutReservedProbeQueueClassSchema,
  scoutProbeTaskQueues,
  scoutTaskQueues,
  type ScoutReservedProbeQueueClass,
  type ScoutStage,
} from "@scout-for-lol/temporal";
import type { ScoutTemporalActivities } from "@scout-for-lol/temporal/activities";
import type {
  ScoutQueueCanaryProbeInput,
  ScoutQueueCanaryProbeResult,
} from "@scout-for-lol/temporal/contracts";
import { ApplicationFailure } from "@temporalio/common";

type ProbeQueue = ScoutTemporalActivities["probeQueue"];

export type ScoutActivityQueueClass = Exclude<
  ScoutTemporalQueueClass,
  "workflow"
>;

/**
 * The activity groups a plan is built from. Every class whose canary probe is
 * reserved carries `probeQueue`, which its reserved worker reuses so the probe
 * runs the same Activity code the work queue's worker registered.
 */
export type ScoutActivityWorkerGroups = Readonly<
  Record<ScoutActivityQueueClass, object> &
    Record<ScoutReservedProbeQueueClass, { readonly probeQueue: ProbeQueue }>
>;

/** One Activity worker the connected runtime creates. */
export type ScoutActivityWorkerPlan = {
  readonly queueClass: ScoutActivityQueueClass;
  readonly taskQueue: string;
  readonly activities: object;
  readonly maxConcurrentActivityTaskExecutions: number;
  /** For a reserved probe worker, the work queue whose worker it attests. */
  readonly attestsTaskQueue?: string;
};

/**
 * The work queues' slot budgets.
 *
 * `background` runs one Activity at a time by design: ingestion
 * reconciliation relies on that serialization (`ingestion-reconciliation.ts`).
 * `lake` and `crawl` are single-writer. None of them may lend a slot to the
 * release canary, which is what the reserved probe workers are for.
 */
const WORK_QUEUE_SLOTS = {
  interactive: 2,
  gateway: 2,
  lake: 1,
  realtime: 4,
  crawl: 1,
  background: 1,
} as const satisfies Record<ScoutActivityQueueClass, number>;

/** Creation order, unchanged from before reserved probe workers existed. */
const ACTIVITY_WORKER_ORDER = [
  "interactive",
  "gateway",
  "lake",
  "realtime",
  "crawl",
  "background",
] as const satisfies readonly ScoutActivityQueueClass[];

/**
 * A reserved probe worker runs nothing but an instantaneous probe. Two slots
 * let a pinned candidate canary and a normally routed canary overlap.
 */
export const RESERVED_PROBE_SLOTS = 2;

/**
 * The canary probe a reserved `-probe` worker serves.
 *
 * It executes on the reserved queue, so it never waits for a work-queue slot,
 * and it reports the work queue only after checking that the worker polling
 * that queue in this same process is running. A busy work queue is still a
 * served one; a stopped or failed worker is not, and fails the canary loudly.
 */
export function reservedQueueProbeActivities(options: {
  readonly probeQueue: ProbeQueue;
  readonly attestsTaskQueue: string;
  readonly workerState: () => string | undefined;
}): { probeQueue: ProbeQueue } {
  return {
    probeQueue: async (
      input: ScoutQueueCanaryProbeInput,
    ): Promise<ScoutQueueCanaryProbeResult> => {
      const state = options.workerState();
      if (state !== "RUNNING") {
        throw ApplicationFailure.nonRetryable(
          `Scout ${input.queueClass} worker for ${options.attestsTaskQueue} is ${state ?? "absent"}, not RUNNING`,
          "ScoutQueueWorkerNotRunning",
        );
      }
      const probed = await options.probeQueue(input);
      return {
        ...probed,
        taskQueue: options.attestsTaskQueue,
        probeTaskQueue: probed.taskQueue,
      };
    },
  };
}

/**
 * Every Activity worker a process with these queue classes runs: each work
 * queue, followed by its reserved probe queue where the canary probes one.
 *
 * `workerState` reads a created worker's state by task queue at probe time,
 * so the reserved worker attests the live state of its sibling rather than
 * the fact that it was once created.
 */
export function scoutActivityWorkerPlans(
  stage: ScoutStage,
  queueClasses: ReadonlySet<ScoutTemporalQueueClass>,
  activities: ScoutActivityWorkerGroups,
  workerState: (taskQueue: string) => string | undefined,
): ScoutActivityWorkerPlan[] {
  const queues = scoutTaskQueues(stage);
  const probeQueues = scoutProbeTaskQueues(stage);
  return ACTIVITY_WORKER_ORDER.filter((queueClass) =>
    queueClasses.has(queueClass),
  ).flatMap((queueClass): ScoutActivityWorkerPlan[] => {
    const taskQueue = queues[queueClass];
    const work: ScoutActivityWorkerPlan = {
      queueClass,
      taskQueue,
      activities: activities[queueClass],
      maxConcurrentActivityTaskExecutions: WORK_QUEUE_SLOTS[queueClass],
    };
    const reserved = ScoutReservedProbeQueueClassSchema.safeParse(queueClass);
    if (!reserved.success) return [work];
    return [
      work,
      {
        queueClass,
        taskQueue: probeQueues[reserved.data],
        activities: reservedQueueProbeActivities({
          probeQueue: activities[reserved.data].probeQueue,
          attestsTaskQueue: taskQueue,
          workerState: () => workerState(taskQueue),
        }),
        maxConcurrentActivityTaskExecutions: RESERVED_PROBE_SLOTS,
        attestsTaskQueue: taskQueue,
      },
    ];
  });
}
