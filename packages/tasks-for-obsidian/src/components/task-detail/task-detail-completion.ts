import {
  completionTargetDate,
  isCompletedOn,
  isRecurring,
  localTodayYmd,
} from "../../domain/recurrence";
import { isCompletedStatus, STATUS_LABELS } from "../../domain/status";
import type { Task } from "../../domain/types";

export type TaskDetailCompletionAction = {
  readonly completed: boolean;
  readonly label: "Mark Complete" | "Mark Incomplete";
  readonly value: string;
  readonly scope: "occurrence" | "task-status";
};

export function taskDetailCompletionAction(
  task: Task,
  today: string = localTodayYmd(),
): TaskDetailCompletionAction {
  const globallyCompleted = isCompletedStatus(task.status);
  const completed = isCompletedOn(
    task,
    isRecurring(task) ? completionTargetDate(task, today) : today,
  );

  return {
    completed,
    label: completed ? "Mark Incomplete" : "Mark Complete",
    value: completed ? "Done" : STATUS_LABELS[task.status],
    scope: globallyCompleted ? "task-status" : "occurrence",
  };
}
