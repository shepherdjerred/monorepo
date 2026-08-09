import { describe, expect, test } from "bun:test";

import type { Task } from "../../domain/types";
import { contextName, projectName, tagName, taskId } from "../../domain/types";
import { deriveKanbanCardPresentation } from "./kanban-card-model";

const REFERENCE_DATE = new Date(2026, 7, 8, 12, 0, 0);

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: taskId("application"),
    path: "Tasks/application.md",
    title: "Prepare interview",
    status: "open",
    priority: "highest",
    contexts: [contextName("computer")],
    projects: [projectName("[[2026 Job Search]]")],
    tags: [tagName("screener")],
    scheduled: "2026-08-08",
    due: "2026-08-09",
    completeInstances: [],
    skippedInstances: [],
    timeEntries: [],
    blockedBy: [],
    reminders: [],
    archived: false,
    totalTrackedTime: 0,
    isBlocked: false,
    isBlocking: false,
    extraFields: {},
    ...overrides,
  };
}

describe("deriveKanbanCardPresentation", () => {
  test("keeps the shared planned, deadline, organization, and priority semantics", () => {
    const presentation = deriveKanbanCardPresentation(
      makeTask(),
      REFERENCE_DATE,
      true,
    );

    expect(presentation.metadata.map((item) => item.label)).toEqual([
      "Planned · Today",
      "Deadline · Tomorrow",
      "2026 Job Search",
    ]);
    expect(presentation.indicators.map((item) => item.label)).toEqual([
      "P1",
      "Pending",
    ]);
    expect(presentation.accessibilityLabel).toContain("Planned for today");
    expect(presentation.accessibilityLabel).toContain("Deadline tomorrow");
    expect(presentation.accessibilityLabel).toContain("Highest priority (P1)");
    expect(presentation.accessibilityLabel).toContain("Waiting to sync");
  });

  test("uses explicit completed semantics for the menu and accessibility", () => {
    const presentation = deriveKanbanCardPresentation(
      makeTask({ status: "done" }),
      REFERENCE_DATE,
      false,
    );

    expect(presentation.completed).toBe(true);
    expect(presentation.completionActionTitle).toBe("Uncomplete");
    expect(presentation.accessibilityLabel.endsWith(", completed")).toBe(true);
  });

  test("reads the recurring occurrence that the board toggle targets", () => {
    const presentation = deriveKanbanCardPresentation(
      makeTask({
        status: "open",
        recurrence: "FREQ=WEEKLY",
        completeInstances: ["2026-08-08"],
      }),
      REFERENCE_DATE,
      false,
    );

    expect(presentation.completed).toBe(true);
    expect(presentation.completionActionTitle).toBe("Uncomplete");
  });
});
