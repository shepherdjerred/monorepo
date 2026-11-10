import path from "node:path";
import { Client, Connection } from "@temporalio/client";
import { z } from "zod";
import { WORKFLOW_TASK_QUEUES } from "#shared/task-queues.ts";
import { WorkerDeploymentRolloutTargetSchema } from "#lib/worker-deployment-target.ts";

type Target = z.infer<typeof WorkerDeploymentRolloutTargetSchema>;
const name = z.string().regex(/^[A-Za-z_$][\w$-]*$/u);
/** Visibility reads per registered type overlap; selection order stays the type order. */
export const REPLAY_SELECTION_CONCURRENCY = 8;

export function workerReplayRoute(target: Target) {
  WorkerDeploymentRolloutTargetSchema.parse(target);
  return {
    namespace: target === "scout-beta" ? "beta" : "prod",
    taskQueues: target === "central" ? [...WORKFLOW_TASK_QUEUES] : [target],
    entrypoint:
      target === "central"
        ? "packages/temporal/src/workflows/index.ts"
        : "packages/scout-for-lol/packages/temporal/src/workflows/index.ts",
  };
}

export function registeredWorkerWorkflowTypes(source: string) {
  return z
    .array(name)
    .min(1)
    .max(200)
    .parse(new Bun.Transpiler({ loader: "ts" }).scan(source).exports)
    .sort();
}

/** One exact retained run per registered type; a missing type is reported, never replayed. */
export async function selectWorkerReplayTargets(
  types: readonly string[],
  taskQueues: readonly string[],
  first: (query: string) => Promise<unknown>,
) {
  z.array(name).min(1).max(200).parse(types);
  z.array(name).min(1).parse(taskQueues);
  if (new Set(types).size !== types.length)
    throw new Error("Duplicate registered Workflow types");
  const queues = taskQueues.map((queue) => `'${queue}'`).join(", ");
  const select = async (type: string) => {
    const query = `TaskQueue IN (${queues}) AND WorkflowType = '${type}'`;
    const raw =
      (await first(`${query} AND ExecutionStatus = 'Running'`)) ??
      (await first(`${query} AND ExecutionStatus != 'Running'`));
    if (raw === null) return { type, execution: null };
    const execution = z
      .object({
        workflowId: z.string().min(1),
        runId: z.uuid(),
        type: z.literal(type),
        taskQueue: z.string(),
      })
      .parse(raw);
    if (!taskQueues.includes(execution.taskQueue))
      throw new Error("Replay history belongs to another task queue");
    return {
      type,
      execution: { workflowId: execution.workflowId, runId: execution.runId },
    };
  };
  // Fixed-size ordered batches keep at most the bound in flight.
  const selected = [];
  for (
    let start = 0;
    start < types.length;
    start += REPLAY_SELECTION_CONCURRENCY
  )
    selected.push(
      ...(await Promise.all(
        types
          .slice(start, start + REPLAY_SELECTION_CONCURRENCY)
          .map((type) => select(type)),
      )),
    );
  const targets: { workflowId: string; runId: string }[] = [],
    missingTypes: string[] = [];
  for (const { type, execution } of selected)
    if (execution === null) missingTypes.push(type);
    else targets.push(execution);
  if (targets.length === 0)
    throw new Error(
      `No retained histories for registered Workflow types: ${missingTypes.join(", ")}`,
    );
  return { targets, missingTypes };
}

export async function workerReplayArguments(directory: string, target: Target) {
  const route = workerReplayRoute(target);
  const types = registeredWorkerWorkflowTypes(
    await Bun.file(path.join(directory, route.entrypoint)).text(),
  );
  const connection = await Connection.connect({
    address: "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
  });
  try {
    const client = new Client({ connection, namespace: route.namespace });
    const started = performance.now();
    const selection = await selectWorkerReplayTargets(
      types,
      route.taskQueues,
      async (query) => {
        // Temporal's default order is CloseTime DESC NULL FIRST, then StartTime DESC.
        for await (const execution of client.workflow.list({
          query,
          pageSize: 1,
        }))
          return execution;
        return null;
      },
    );
    console.warn(
      JSON.stringify({
        kind: "worker-candidate-replay-selection",
        namespace: route.namespace,
        selectedTypes: selection.targets.length,
        typesWithoutRetainedHistory: selection.missingTypes,
        durationMs: Math.round(performance.now() - started),
      }),
    );
    return selection.targets.flatMap(({ workflowId, runId }) => [
      "--run",
      workflowId,
      runId,
    ]);
  } finally {
    await connection.close();
  }
}
