import type { Task, TaskId } from "./types";

export function findTaskByResolvedId(
  tasks: ReadonlyMap<TaskId, Task>,
  resolveTaskId: (id: TaskId) => TaskId,
  id: TaskId,
): Task | null {
  const resolvedId = resolveTaskId(id);
  return tasks.get(resolvedId) ?? tasks.get(id) ?? null;
}
