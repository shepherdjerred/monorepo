import { describe, expect, test } from "bun:test";

import { deriveTaskPresentation } from "./task-presentation";
import type { TaskDateRelation } from "./task-presentation";
import type { Task } from "./types";
import { contextName, projectName, tagName, taskId } from "./types";

const REFERENCE_DATE = new Date(2026, 7, 7, 12, 0, 0);

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: taskId("task-1"),
    path: "Tasks/task-1.md",
    title: "Prepare launch",
    status: "open",
    priority: "normal",
    contexts: [],
    projects: [],
    tags: [],
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

function present(task: Task, pending = false) {
  return deriveTaskPresentation(task, {
    referenceDate: REFERENCE_DATE,
    pending,
  });
}

describe("deriveTaskPresentation dates", () => {
  test("keeps planned and deadline dates distinct even on the same day", () => {
    const presentation = present(
      makeTask({ scheduled: "2026-08-07", due: "2026-08-07" }),
    );

    expect(presentation.metadata).toEqual([
      {
        kind: "planned",
        date: "2026-08-07",
        relation: "today",
        label: "Planned · Today",
        accessibilityLabel: "Planned for today",
      },
      {
        kind: "deadline",
        date: "2026-08-07",
        relation: "today",
        label: "Deadline · Today",
        accessibilityLabel: "Deadline today",
      },
    ]);
  });

  test("classifies overdue, today, tomorrow, and absolute planned dates", () => {
    const cases: readonly {
      readonly date: string;
      readonly relation: TaskDateRelation;
      readonly label: string;
      readonly accessibilityLabel: string;
    }[] = [
      {
        date: "2026-08-05",
        relation: "overdue",
        label: "Planned · Aug 5",
        accessibilityLabel: "Planned date overdue, August 5",
      },
      {
        date: "2026-08-07",
        relation: "today",
        label: "Planned · Today",
        accessibilityLabel: "Planned for today",
      },
      {
        date: "2026-08-08",
        relation: "tomorrow",
        label: "Planned · Tomorrow",
        accessibilityLabel: "Planned for tomorrow",
      },
      {
        date: "2026-08-15",
        relation: "absolute",
        label: "Planned · Aug 15",
        accessibilityLabel: "Planned for August 15",
      },
      {
        date: "2027-01-03",
        relation: "absolute",
        label: "Planned · Jan 3, 2027",
        accessibilityLabel: "Planned for January 3, 2027",
      },
    ];

    for (const expected of cases) {
      expect(present(makeTask({ scheduled: expected.date })).metadata).toEqual([
        {
          kind: "planned",
          date: expected.date,
          relation: expected.relation,
          label: expected.label,
          accessibilityLabel: expected.accessibilityLabel,
        },
      ]);
    }
  });

  test("classifies every relation while labeling due as a deadline", () => {
    const cases: readonly {
      readonly date: string;
      readonly relation: TaskDateRelation;
      readonly label: string;
      readonly accessibilityLabel: string;
    }[] = [
      {
        date: "2026-08-06",
        relation: "overdue",
        label: "Deadline · Aug 6",
        accessibilityLabel: "Deadline overdue, August 6",
      },
      {
        date: "2026-08-07",
        relation: "today",
        label: "Deadline · Today",
        accessibilityLabel: "Deadline today",
      },
      {
        date: "2026-08-08",
        relation: "tomorrow",
        label: "Deadline · Tomorrow",
        accessibilityLabel: "Deadline tomorrow",
      },
      {
        date: "2026-08-15",
        relation: "absolute",
        label: "Deadline · Aug 15",
        accessibilityLabel: "Deadline August 15",
      },
    ];

    for (const expected of cases) {
      expect(present(makeTask({ due: expected.date })).metadata).toEqual([
        {
          kind: "deadline",
          date: expected.date,
          relation: expected.relation,
          label: expected.label,
          accessibilityLabel: expected.accessibilityLabel,
        },
      ]);
    }
  });

  test("normalizes date-only values as local calendar dates", () => {
    const presentation = present(
      makeTask({ scheduled: "2026-08-07", due: "2026-08-08" }),
    );

    expect(
      presentation.metadata.map((item) =>
        "date" in item ? item.date : item.value,
      ),
    ).toEqual(["2026-08-07", "2026-08-08"]);
  });
});

describe("deriveTaskPresentation metadata", () => {
  test("projects a derived collection date without mutating task dates", () => {
    const task = makeTask({
      scheduled: "2026-08-01",
      due: "2026-08-06",
      recurrence: "FREQ=WEEKLY",
    });
    const presentation = deriveTaskPresentation(task, {
      referenceDate: REFERENCE_DATE,
      pending: false,
      dateContext: { kind: "planned", date: "2026-08-08" },
    });

    expect(presentation.metadata).toEqual([
      {
        kind: "planned",
        date: "2026-08-08",
        relation: "tomorrow",
        label: "Planned · Tomorrow",
        accessibilityLabel: "Planned for tomorrow",
      },
      {
        kind: "deadline",
        date: "2026-08-06",
        relation: "overdue",
        label: "Deadline · Aug 6",
        accessibilityLabel: "Deadline overdue, August 6",
      },
    ]);
    expect(task.scheduled).toBe("2026-08-01");
  });

  test("orders metadata as planned, deadline, project, then context", () => {
    const presentation = present(
      makeTask({
        scheduled: "2026-08-07",
        due: "2026-08-08",
        projects: [
          projectName("[[Projects/Work]]"),
          projectName("[[Projects/Side project]]"),
        ],
        contexts: [contextName("office"), contextName("computer")],
        tags: [tagName("urgent")],
      }),
    );

    expect(presentation.metadata.map((item) => item.kind)).toEqual([
      "planned",
      "deadline",
      "project",
      "context",
    ]);
    expect(presentation.metadata.map((item) => item.label)).toEqual([
      "Planned · Today",
      "Deadline · Tomorrow",
      "Work",
      "@office",
    ]);
  });

  test("uses the first tag when no context is available", () => {
    const presentation = present(
      makeTask({ tags: [tagName("urgent"), tagName("launch")] }),
    );

    expect(presentation.metadata).toEqual([
      {
        kind: "tag",
        value: "urgent",
        label: "#urgent",
        accessibilityLabel: "Tag urgent",
      },
    ]);
  });
});

describe("deriveTaskPresentation indicators", () => {
  test("provides visible and accessible priority and blocked signals", () => {
    const presentation = present(
      makeTask({
        priority: "highest",
        isBlocked: true,
        blockedBy: [{ uid: "one" }, { uid: "two" }],
      }),
    );

    expect(presentation.indicators).toEqual([
      {
        kind: "priority",
        value: "highest",
        label: "P1",
        accessibilityLabel: "Highest priority (P1)",
      },
      {
        kind: "blocked",
        blockerCount: 2,
        label: "Blocked · 2",
        accessibilityLabel: "Blocked by 2 tasks",
      },
    ]);
  });

  test("maps every non-default priority to a text signal", () => {
    const cases = [
      ["highest", "P1", "Highest priority (P1)"],
      ["high", "P2", "High priority (P2)"],
      ["medium", "P3", "Medium priority (P3)"],
      ["low", "P4", "Low priority (P4)"],
    ] as const;

    for (const [priority, label, accessibilityLabel] of cases) {
      expect(present(makeTask({ priority })).indicators).toEqual([
        {
          kind: "priority",
          value: priority,
          label,
          accessibilityLabel,
        },
      ]);
    }
    expect(present(makeTask({ priority: "normal" })).indicators).toEqual([]);
    expect(present(makeTask({ priority: "none" })).indicators).toEqual([]);
  });

  test("orders recurrence, estimate, tracked time, and supplied sync state", () => {
    const presentation = present(
      makeTask({
        recurrence: "FREQ=WEEKLY;BYDAY=FR",
        timeEstimate: 90,
        totalTrackedTime: 45,
      }),
      true,
    );

    expect(presentation.indicators).toEqual([
      {
        kind: "recurrence",
        value: "FREQ=WEEKLY;BYDAY=FR",
        label: "Repeats",
        accessibilityLabel: "Recurring task",
      },
      {
        kind: "estimate",
        minutes: 90,
        label: "Est. 1h 30m",
        accessibilityLabel: "Estimated time 1 hour 30 minutes",
      },
      {
        kind: "tracked",
        minutes: 45,
        label: "45m tracked",
        accessibilityLabel: "45 minutes tracked",
      },
      {
        kind: "pending-sync",
        label: "Pending",
        accessibilityLabel: "Waiting to sync",
      },
    ]);
  });

  test("keeps pending sync as an explicit caller input", () => {
    const task = makeTask();

    expect(present(task, false).indicators).toEqual([]);
    expect(present(task, true).indicators).toEqual([
      {
        kind: "pending-sync",
        label: "Pending",
        accessibilityLabel: "Waiting to sync",
      },
    ]);
  });
});

describe("deriveTaskPresentation accessibility and validation", () => {
  test("builds complete accessibility text including hidden organization detail", () => {
    const presentation = present(
      makeTask({
        scheduled: "2026-08-07",
        due: "2026-08-08",
        priority: "high",
        projects: [
          projectName("[[Projects/Work]]"),
          projectName("[[Projects/Launch]]"),
        ],
        contexts: [contextName("office")],
        tags: [tagName("urgent")],
        recurrence: "FREQ=DAILY",
        isBlocked: true,
        blockedBy: [{ uid: "dependency" }],
        timeEstimate: 60,
        totalTrackedTime: 1,
      }),
      true,
    );

    expect(presentation.accessibilityLabel).toBe(
      "Task: Prepare launch, Planned for today, Deadline tomorrow, Projects Work, Launch, Context office, Tag urgent, High priority (P2), Blocked by 1 task, Recurring task, Estimated time 1 hour, 1 minute tracked, Waiting to sync",
    );
  });

  test("fails loudly for invalid dates and durations", () => {
    expect(() =>
      deriveTaskPresentation(makeTask(), {
        referenceDate: new Date("invalid"),
        pending: false,
      }),
    ).toThrow("Invalid reference date");
    expect(() => present(makeTask({ due: "2026-02-31" }))).toThrow(
      "Invalid task date: 2026-02-31",
    );
    expect(() => present(makeTask({ timeEstimate: -1 }))).toThrow(
      "Invalid time estimate: -1",
    );
    expect(() => present(makeTask({ totalTrackedTime: Number.NaN }))).toThrow(
      "Invalid total tracked time: NaN",
    );
  });
});
