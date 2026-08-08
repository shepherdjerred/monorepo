import { describe, expect, test } from "bun:test";

import { TaskSchema } from "../../domain/schemas";
import { taskDetailCompletionAction } from "./task-detail-completion";

function recurringTask(status: "open" | "done", completeInstances: string[]) {
  return TaskSchema.parse({
    id: "Tasks/weekly.md",
    path: "Tasks/weekly.md",
    title: "Weekly review",
    status,
    recurrence: "DTSTART:20260808;FREQ=WEEKLY",
    scheduled: "2026-08-08",
    completeInstances,
  });
}

describe("task detail completion action", () => {
  test("toggles the visible occurrence for an active recurring task", () => {
    expect(
      taskDetailCompletionAction(
        recurringTask("open", ["2026-08-08"]),
        "2026-08-08",
      ),
    ).toEqual({
      completed: true,
      label: "Mark Incomplete",
      value: "Done",
      scope: "occurrence",
    });
  });

  test("uncompletes a globally completed recurring parent through status", () => {
    expect(
      taskDetailCompletionAction(recurringTask("done", []), "2026-08-08"),
    ).toEqual({
      completed: true,
      label: "Mark Incomplete",
      value: "Done",
      scope: "task-status",
    });
  });

  test("shows the next occurrence as open after an earlier instance completes", () => {
    expect(
      taskDetailCompletionAction(
        recurringTask("open", ["2026-08-01"]),
        "2026-08-08",
      ),
    ).toEqual({
      completed: false,
      label: "Mark Complete",
      value: "Open",
      scope: "occurrence",
    });
  });
});
