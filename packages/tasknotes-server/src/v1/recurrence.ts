import { taskCompletion } from "@shepherdjerred/facet-protocol/recurrence";
import type { Task } from "../protocol/generated.ts";
import type { UpdateTaskInput } from "./types.ts";

export function buildTaskCompletionUpdate(
  task: Task,
  completedAt: Date,
): UpdateTaskInput {
  const result = taskCompletion(task, completedAt);
  if (result.kind === "completed") return { completed: true, completedAt };
  return {
    completed: false,
    completedAt: null,
    isRecurring: true,
    recurrenceRule: result.recurrenceRule,
    dueDate: result.dueDate,
    dueDatetime: result.dueDatetime,
  };
}
