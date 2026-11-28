import { z } from "zod";
import type { MaintenanceRequest } from "#shared/ci-maintenance.ts";
import {
  assertMaintenanceReceipt,
  maintenancePipeline,
  maintenanceRequest,
  required,
  woodpeckerRequest,
  type MaintenancePipeline,
} from "./ci-maintenance-client.ts";

/** No agent has taken the pipeline: it is queued and no step of any kind has started. */
function stillQueued(pipeline: MaintenancePipeline) {
  return (
    ["created", "pending"].includes(pipeline.status) &&
    pipeline.workflows.every((workflow) =>
      (workflow.children ?? []).every((child) => (child.started ?? 0) === 0),
    )
  );
}

// Go encodes an empty task list as null.
const QueueTasksSchema = z
  .array(
    z.object({
      pipeline_number: z.number().int().optional(),
      repo_id: z.number().int().optional(),
      labels: z.record(z.string(), z.string()).nullable(),
      created: z.number().int(),
      concurrency_group: z.string().optional(),
    }),
  )
  .nullable()
  .transform((tasks) => tasks ?? []);
/** Woodpecker's `/api/queue/info`: every task not yet finished, with its agent labels. */
export const WoodpeckerQueueSchema = z.object({
  paused: z.boolean(),
  pending: QueueTasksSchema,
  waiting_on_deps: QueueTasksSchema,
  running: QueueTasksSchema,
});
export type WoodpeckerQueue = z.infer<typeof WoodpeckerQueueSchema>;
type QueueTask = WoodpeckerQueue["pending"][number];
type QueueEvidence = { stuck: boolean; reason: string };

function poolOf(task: QueueTask) {
  return task.labels?.["ci-pool"] ?? "unlabeled";
}

/** Whether one pending task cannot run: bypassed in its pool, or heading an idle pool. */
function stuckTaskEvidence(
  queue: WoodpeckerQueue,
  task: QueueTask,
): QueueEvidence {
  const pool = poolOf(task);
  const group = task.concurrency_group;
  if (
    group !== undefined &&
    group !== "" &&
    queue.running.some((other) => other.concurrency_group === group)
  )
    return { stuck: false, reason: `its concurrency group ${group} is busy` };
  const running = queue.running.filter((other) => poolOf(other) === pool);
  const newer = running.filter((other) => other.created > task.created);
  if (newer.length > 0)
    return {
      stuck: true,
      reason: `${newer.length.toString()} newer ${pool}-pool task(s) started ahead of it, so no agent takes it`,
    };
  const older = queue.pending.filter(
    (other) => other.created < task.created && poolOf(other) === pool,
  ).length;
  if (older === 0 && running.length === 0)
    return {
      stuck: true,
      reason: `it heads an idle ${pool} pool, so no connected agent matches it`,
    };
  return {
    stuck: false,
    reason:
      running.length === 0
        ? `the ${pool} pool is taking no work, and ${older.toString()} older task(s) wait too`
        : `${older.toString()} older ${pool}-pool task(s) are ahead of it in the queue`,
  };
}

/**
 * Whether a queued maintenance pipeline is stuck rather than slow, read from
 * Woodpecker's task queue. Woodpecker hands each agent the oldest pending task
 * the agent matches, so a task behind a long backlog only waits. It is stuck
 * when newer tasks in its agent pool run ahead of it (no agent matches it),
 * when it heads an idle pool, or when the queue holds no task for it.
 */
export function queuedMaintenanceEvidence(
  queue: WoodpeckerQueue,
  pipeline: number,
  repoId: number,
): QueueEvidence {
  if (queue.paused)
    return { stuck: false, reason: "the Woodpecker queue is paused" };
  const own = (task: QueueTask) =>
    task.pipeline_number === pipeline && task.repo_id === repoId;
  if (queue.running.some((task) => own(task)))
    return { stuck: false, reason: "an agent has taken it" };
  const pending = queue.pending.filter((task) => own(task));
  if (pending.length === 0)
    return queue.waiting_on_deps.some((task) => own(task))
      ? { stuck: false, reason: "it waits on its dependencies" }
      : { stuck: true, reason: "Woodpecker's queue holds no task for it" };
  const evidence = pending.map((task) => stuckTaskEvidence(queue, task));
  return (
    evidence.find((entry) => entry.stuck) ??
    evidence[0] ?? { stuck: false, reason: "it is queued" }
  );
}

export type StuckMaintenanceOutcome = {
  /**
   * `waiting`: queued but not stuck, so it keeps its place. `not-queued`: it
   * has left the queue. `canceled`: Woodpecker canceled it. `uncertain`: a
   * cancel was sent but not confirmed; it is never sent again.
   */
  outcome: "waiting" | "not-queued" | "canceled" | "uncertain";
  detail: string;
};

/** Reads the pipeline back after an unconfirmed cancel to learn what happened. */
async function classifyAfterCancel(
  number: number,
  evidence: string,
  failure: string,
): Promise<StuckMaintenanceOutcome> {
  let pipeline: MaintenancePipeline;
  try {
    pipeline = await maintenancePipeline(number);
  } catch {
    return { outcome: "uncertain", detail: `${failure}; read-back failed` };
  }
  if (["killed", "canceled"].includes(pipeline.status))
    return { outcome: "canceled", detail: evidence };
  return stillQueued(pipeline)
    ? { outcome: "uncertain", detail: `${failure}; still queued` }
    : { outcome: "not-queued", detail: `it is ${pipeline.status}` };
}

/**
 * Cancels the request's pipeline only while it is queued and stuck. The
 * pipeline is matched to the request ID, the queue evidence is read, and the
 * pipeline is re-read immediately before the cancel, because Woodpecker's
 * cancel also kills a running pipeline. Once the cancel is sent, every
 * outcome is returned rather than thrown.
 */
export async function cancelStuckMaintenance(
  request: MaintenanceRequest,
): Promise<StuckMaintenanceOutcome> {
  if (request.pipeline === null)
    throw new Error("Only a request with a pipeline receipt can be aged out");
  const receipt = await maintenancePipeline(request.pipeline);
  assertMaintenanceReceipt(receipt, request);
  if (!stillQueued(receipt))
    return { outcome: "not-queued", detail: `it is ${receipt.status}` };
  const queueResponse = await woodpeckerRequest("/api/queue/info");
  if (!queueResponse.ok)
    throw new Error(`Woodpecker queue HTTP ${queueResponse.status.toString()}`);
  const evidence = queuedMaintenanceEvidence(
    WoodpeckerQueueSchema.parse(await queueResponse.json()),
    receipt.number,
    Number(required("WOODPECKER_REPO_ID")),
  );
  if (!evidence.stuck) return { outcome: "waiting", detail: evidence.reason };
  const latest = await maintenancePipeline(receipt.number);
  if (!stillQueued(latest))
    return { outcome: "not-queued", detail: `it is ${latest.status}` };
  let response: Response;
  try {
    response = await maintenanceRequest(
      `/${receipt.number.toString()}/cancel`,
      { method: "POST" },
    );
  } catch (error: unknown) {
    return await classifyAfterCancel(
      receipt.number,
      evidence.reason,
      `cancel request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return response.ok
    ? { outcome: "canceled", detail: evidence.reason }
    : await classifyAfterCancel(
        receipt.number,
        evidence.reason,
        `cancel returned HTTP ${response.status.toString()}`,
      );
}
