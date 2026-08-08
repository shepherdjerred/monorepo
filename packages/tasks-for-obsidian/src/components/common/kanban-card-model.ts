import {
  completionTargetDate,
  isCompletedOn,
  isRecurring,
  localTodayYmd,
} from "../../domain/recurrence";
import {
  deriveTaskPresentation,
  type TaskIndicatorPresentation,
  type TaskMetadataPresentation,
} from "../../domain/task-presentation";
import type { Task } from "../../domain/types";

export type KanbanCardPresentation = {
  readonly title: string;
  readonly metadata: readonly TaskMetadataPresentation[];
  readonly indicators: readonly TaskIndicatorPresentation[];
  readonly completed: boolean;
  readonly completionActionTitle: "Complete" | "Uncomplete";
  readonly accessibilityLabel: string;
};

/** A board-density adaptation of the shared task presentation contract. */
export function deriveKanbanCardPresentation(
  task: Task,
  referenceDate: Date,
  pending: boolean,
): KanbanCardPresentation {
  const presentation = deriveTaskPresentation(task, {
    referenceDate,
    pending,
  });
  const referenceDay = localTodayYmd(referenceDate);
  const completed = isCompletedOn(
    task,
    isRecurring(task) ? completionTargetDate(task, referenceDay) : referenceDay,
  );

  return {
    title: presentation.title,
    metadata: presentation.metadata.slice(0, 3),
    indicators: presentation.indicators.slice(0, 3),
    completed,
    completionActionTitle: completed ? "Uncomplete" : "Complete",
    accessibilityLabel: completed
      ? `${presentation.accessibilityLabel}, completed`
      : presentation.accessibilityLabel,
  };
}
