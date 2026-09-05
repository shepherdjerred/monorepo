import type { TemporalNamespace } from "./temporal-namespace.ts";
import { TASK_QUEUES, type TaskQueue } from "#shared/task-queues.ts";
import type { WorkerRole } from "./worker-role.ts";

export function assertCentralWorkerNamespace(
  role: WorkerRole,
  namespace: TemporalNamespace,
): void {
  const expected = role === "all" ? "dev" : "prod";
  if (namespace !== expected) {
    throw new Error(
      `Temporal worker role ${role} requires namespace ${expected}, received ${namespace}`,
    );
  }
}

export function workerNamespaces(input: {
  queueRole: WorkerRole;
  taskQueue: TaskQueue;
  activeNamespace: TemporalNamespace;
}): readonly TemporalNamespace[] {
  return (input.queueRole === "scout" ||
    (input.queueRole === "workflows" &&
      input.taskQueue === TASK_QUEUES.WORKFLOWS)) &&
    input.activeNamespace === "prod"
    ? ["prod", "beta"]
    : [input.activeNamespace];
}
