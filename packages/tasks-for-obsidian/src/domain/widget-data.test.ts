import { describe, expect, test } from "bun:test";

import { TaskSchema } from "./schemas";
import { deriveWidgetData, deriveWidgetDataEnvelope } from "./widget-data";

describe("deriveWidgetData", () => {
  test("shares Today scheduled, deadline, overdue, and recurrence semantics", () => {
    const referenceDate = new Date(2026, 7, 7, 12);
    const tasks = [
      TaskSchema.parse({
        id: "planned.md",
        title: "Planned today",
        scheduled: "2026-08-07",
        projects: ["[[Projects/Work]]"],
      }),
      TaskSchema.parse({
        id: "deadline.md",
        title: "Deadline today",
        due: "2026-08-07",
      }),
      TaskSchema.parse({
        id: "overdue.md",
        title: "Overdue task",
        due: "2026-08-06",
      }),
      TaskSchema.parse({
        id: "recurring.md",
        title: "Recurring today",
        scheduled: "2026-08-07",
        recurrence: "DTSTART:20260801;FREQ=DAILY",
      }),
      TaskSchema.parse({
        id: "recurring-done.md",
        title: "Completed occurrence",
        scheduled: "2026-08-07",
        recurrence: "DTSTART:20260801;FREQ=DAILY",
        completeInstances: ["2026-08-07"],
      }),
    ];

    const result = deriveWidgetData(tasks, "2026-08-07", referenceDate);

    expect(result.todayTasks.map((task) => task.title)).toEqual([
      "Overdue task",
      "Planned today",
      "Recurring today",
      "Deadline today",
    ]);
    expect(result.todayTasks.map((task) => task.dateLabel)).toEqual([
      "Deadline · Aug 6",
      "Planned · Today",
      "Planned · Today",
      "Deadline · Today",
    ]);
    expect(
      result.todayTasks.find((task) => task.title === "Planned today")?.project,
    ).toBe("Work");
    expect(result.stats).toEqual({ total: 5, overdue: 1, today: 3 });
  });

  test("reads recurring completion from the agenda occurrence, not its deadline", () => {
    const result = deriveWidgetData(
      [
        TaskSchema.parse({
          id: "recurring-deadline.md",
          title: "Recurring with earlier deadline",
          scheduled: "2026-08-07",
          due: "2026-08-06",
          recurrence: "DTSTART:20260801;FREQ=DAILY",
          completeInstances: ["2026-08-06"],
        }),
      ],
      "2026-08-07",
      new Date(2026, 7, 7, 12),
    );

    expect(result.todayTasks[0]?.completed).toBe(false);
    expect(result.todayTasks[0]?.dateLabel).toBe("Deadline · Aug 6");
  });

  test("persists distinct dated projections across midnight", () => {
    const envelope = deriveWidgetDataEnvelope(
      [
        TaskSchema.parse({
          id: "tomorrow.md",
          title: "Tomorrow",
          scheduled: "2026-08-08",
        }),
      ],
      "2026-08-07",
      "2026-08-07T19:00:00.000Z",
      2,
    );

    expect(Object.keys(envelope.projections)).toEqual([
      "2026-08-07",
      "2026-08-08",
    ]);
    expect(envelope.projections["2026-08-07"]?.todayTasks).toEqual([]);
    expect(
      envelope.projections["2026-08-08"]?.todayTasks.map((task) => task.title),
    ).toEqual(["Tomorrow"]);
  });
});
