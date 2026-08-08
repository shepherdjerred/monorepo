import { describe, expect, test } from "bun:test";

import type { Task } from "./types";
import { taskId } from "./types";
import { completionTargetDate } from "./recurrence";
import {
  deriveAgendaDayCounts,
  deriveTodayAgenda,
  deriveUpcomingAgenda,
  deriveUpcomingWeek,
} from "./agenda";

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  const task: Task = {
    id: taskId(id),
    path: `tasks/${id}.md`,
    title: id,
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
  return task;
}

describe("deriveTodayAgenda", () => {
  test("uses Overdue, Today, Due Today precedence without duplicates", () => {
    const bothToday = makeTask("both-today", {
      title: "Both today",
      scheduled: "2026-08-07",
      due: "2026-08-07",
    });
    const futurePlanDueToday = makeTask("due-today", {
      scheduled: "2026-08-09",
      due: "2026-08-07",
    });
    const overduePlan = makeTask("overdue-plan", {
      scheduled: "2026-08-06",
      due: "2026-08-10",
    });

    const result = deriveTodayAgenda(
      [bothToday, futurePlanDueToday, overduePlan],
      "2026-08-07",
    );

    expect(result.map((section) => section.key)).toEqual([
      "overdue",
      "scheduled-today",
      "due-today",
    ]);
    expect(result[0]?.entries.map((entry) => entry.task.id)).toEqual([
      taskId("overdue-plan"),
    ]);
    expect(result[1]?.entries.map((entry) => entry.task.id)).toEqual([
      taskId("both-today"),
    ]);
    expect(result[2]?.entries.map((entry) => entry.task.id)).toEqual([
      taskId("due-today"),
    ]);
    expect(
      result
        .flatMap((section) => section.entries)
        .map((entry) => entry.task.id),
    ).toHaveLength(3);
  });

  test("an overdue deadline wins over a planned date today", () => {
    const result = deriveTodayAgenda(
      [
        makeTask("late-deadline", {
          scheduled: "2026-08-07",
          due: "2026-08-01",
        }),
      ],
      "2026-08-07",
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.key).toBe("overdue");
    expect(result[0]?.entries[0]?.reasons).toEqual([
      { kind: "planned", day: "2026-08-07", recurring: false },
      { kind: "deadline", day: "2026-08-01", recurring: false },
    ]);
  });

  test("includes a recurring occurrence today as planned work", () => {
    const result = deriveTodayAgenda(
      [
        makeTask("daily", {
          recurrence: "DTSTART:20260801;FREQ=DAILY",
          scheduled: "2026-08-07",
        }),
      ],
      "2026-08-07",
    );

    expect(result[0]?.key).toBe("scheduled-today");
    expect(result[0]?.entries[0]?.reasons).toEqual([
      { kind: "planned", day: "2026-08-07", recurring: true },
    ]);
  });

  test("keeps an overdue recurring occurrence aligned with completion", () => {
    const task = makeTask("weekly", {
      recurrence: "DTSTART:20260801;FREQ=WEEKLY",
      scheduled: "2026-08-01",
    });
    const result = deriveTodayAgenda([task], "2026-08-07");

    expect(result[0]?.key).toBe("overdue");
    expect(result[0]?.entries[0]?.day).toBe("2026-08-01");
    expect(result[0]?.entries[0]?.completionDay).toBe("2026-08-01");
    expect(result[0]?.entries[0]?.day).toBe(completionTargetDate(task));
  });

  test("completion-anchored recurrence targets the completion day", () => {
    const result = deriveTodayAgenda(
      [
        makeTask("completion-anchored", {
          recurrence: "DTSTART:20260801;FREQ=WEEKLY",
          recurrenceAnchor: "completion",
          scheduled: "2026-08-01",
        }),
      ],
      "2026-08-07",
    );

    expect(result[0]?.key).toBe("overdue");
    expect(result[0]?.entries[0]?.day).toBe("2026-08-01");
    expect(result[0]?.entries[0]?.completionDay).toBe("2026-08-07");
  });

  test("excludes a completed recurring occurrence", () => {
    const result = deriveTodayAgenda(
      [
        makeTask("daily-done", {
          recurrence: "DTSTART:20260801;FREQ=DAILY",
          scheduled: "2026-08-01",
          completeInstances: ["2026-08-01"],
        }),
      ],
      "2026-08-07",
    );

    expect(result).toEqual([]);
  });

  test("excludes completed, cancelled, archived, and unrelated tasks", () => {
    const result = deriveTodayAgenda(
      [
        makeTask("done", { status: "done", due: "2026-08-07" }),
        makeTask("cancelled", {
          status: "cancelled",
          scheduled: "2026-08-07",
        }),
        makeTask("archived", { archived: true, due: "2026-08-06" }),
        makeTask("future", { due: "2026-08-08" }),
        makeTask("undated"),
      ],
      "2026-08-07",
    );

    expect(result).toEqual([]);
  });

  test("sorts overdue entries by oldest relevant date then title", () => {
    const result = deriveTodayAgenda(
      [
        makeTask("later", { title: "Zulu", due: "2026-08-06" }),
        makeTask("same-z", { title: "Zulu", scheduled: "2026-08-01" }),
        makeTask("same-a", { title: "Alpha", scheduled: "2026-08-01" }),
      ],
      "2026-08-07",
    );

    expect(result[0]?.entries.map((entry) => entry.task.id)).toEqual([
      taskId("same-a"),
      taskId("same-z"),
      taskId("later"),
    ]);
  });
});

describe("deriveUpcomingAgenda", () => {
  test("previews the next recurrence after optimistic completion", () => {
    const result = deriveUpcomingAgenda(
      [
        makeTask("weekly-done", {
          recurrence: "DTSTART:20260801;FREQ=WEEKLY",
          scheduled: "2026-08-08",
          completeInstances: ["2026-08-08"],
        }),
      ],
      "2026-08-07",
    );

    expect(result[0]?.day).toBe("2026-08-15");
    expect(result[0]?.entries[0]?.completionDay).toBe("2026-08-15");
  });

  test("groups each task by its earliest future planned date or deadline", () => {
    const result = deriveUpcomingAgenda(
      [
        makeTask("planned-first", {
          scheduled: "2026-08-08",
          due: "2026-08-10",
        }),
        makeTask("deadline-first", {
          scheduled: "2026-08-12",
          due: "2026-08-09",
        }),
        makeTask("same-day", {
          scheduled: "2026-08-10",
          due: "2026-08-10",
        }),
      ],
      "2026-08-07",
    );

    expect(result.map((section) => section.day)).toEqual([
      "2026-08-08",
      "2026-08-09",
      "2026-08-10",
    ]);
    expect(result[0]?.entries[0]?.primaryKind).toBe("planned");
    expect(result[1]?.entries[0]?.primaryKind).toBe("deadline");
    expect(result[2]?.entries[0]?.primaryKind).toBe("planned");
  });

  test("does not preview a later recurrence while today's occurrence is unfinished", () => {
    const result = deriveUpcomingAgenda(
      [
        makeTask("weekly", {
          recurrence: "DTSTART:20260807;FREQ=WEEKLY",
          scheduled: "2026-08-07",
          due: "2026-07-01",
        }),
      ],
      "2026-08-07",
    );

    expect(result).toEqual([]);
  });

  test("uses the current future schedule as the recurring completion date", () => {
    const task = makeTask("weekly", {
      recurrence: "DTSTART:20260801;FREQ=WEEKLY",
      scheduled: "2026-08-08",
    });
    const result = deriveUpcomingAgenda([task], "2026-08-07");

    expect(result[0]?.day).toBe("2026-08-08");
    expect(result[0]?.entries[0]?.completionDay).toBe("2026-08-08");
    expect(result[0]?.entries[0]?.completionDay).toBe(
      completionTargetDate(task, "2026-08-07"),
    );
    expect(result[0]?.entries[0]?.reasons).toEqual([
      { kind: "planned", day: "2026-08-08", recurring: true },
    ]);
  });

  test("carries an explicit target for a date-less recurring preview", () => {
    const result = deriveUpcomingAgenda(
      [
        makeTask("weekly-preview", {
          recurrence: "DTSTART:20260808;FREQ=WEEKLY",
        }),
      ],
      "2026-08-07",
    );

    expect(result[0]?.day).toBe("2026-08-08");
    expect(result[0]?.entries[0]?.completionDay).toBe("2026-08-08");
  });

  test("excludes a recurring Upcoming occurrence completed for its explicit date", () => {
    const result = deriveUpcomingAgenda(
      [
        makeTask("weekly-done", {
          recurrence: "DTSTART:20260808;FREQ=WEEKLY",
          completeInstances: ["2026-08-08"],
        }),
      ],
      "2026-08-07",
    );

    expect(result[0]?.day).toBe("2026-08-15");
    expect(result[0]?.entries[0]?.completionDay).toBe("2026-08-15");
  });

  test("excludes today, past-only, undated, completed, and archived tasks", () => {
    const result = deriveUpcomingAgenda(
      [
        makeTask("today", { scheduled: "2026-08-07" }),
        makeTask("past", { due: "2026-08-01" }),
        makeTask("undated"),
        makeTask("done", { status: "done", due: "2026-08-08" }),
        makeTask("archived", { archived: true, due: "2026-08-08" }),
      ],
      "2026-08-07",
    );

    expect(result).toEqual([]);
  });
});

describe("agenda contract validation", () => {
  test("rejects duplicate task IDs", () => {
    expect(() =>
      deriveTodayAgenda(
        [
          makeTask("duplicate", { scheduled: "2026-08-07" }),
          makeTask("duplicate", { due: "2026-08-07" }),
        ],
        "2026-08-07",
      ),
    ).toThrow('duplicate task id "duplicate"');
  });

  test("rejects invalid dates and recurrence horizons", () => {
    expect(() => deriveTodayAgenda([], "August 7")).toThrow(
      "expected YYYY-MM-DD",
    );
    expect(() =>
      deriveTodayAgenda(
        [makeTask("bad", { scheduled: "not-a-date" })],
        "2026-08-07",
      ),
    ).toThrow("invalid task date");
    expect(() =>
      deriveTodayAgenda(
        [makeTask("bad-calendar-day", { due: "2026-02-31" })],
        "2026-08-07",
      ),
    ).toThrow("invalid task date");
    expect(() => deriveUpcomingAgenda([], "2026-08-07", 0)).toThrow(
      "positive integer",
    );
  });
});

describe("deriveUpcomingWeek", () => {
  test("builds exact future days with recurrence-aware agenda counts", () => {
    const agenda = deriveUpcomingAgenda(
      [
        makeTask("tomorrow", { scheduled: "2026-08-08" }),
        makeTask("also-tomorrow", { due: "2026-08-08" }),
        makeTask("later", { due: "2026-08-10" }),
      ],
      "2026-08-07",
    );

    expect(deriveUpcomingWeek(agenda, "2026-08-07", 4)).toEqual([
      { day: "2026-08-08", count: 2 },
      { day: "2026-08-09", count: 0 },
      { day: "2026-08-10", count: 1 },
      { day: "2026-08-11", count: 0 },
    ]);
  });

  test("rejects invalid strip lengths", () => {
    expect(() => deriveUpcomingWeek([], "2026-08-07", 0)).toThrow(
      "integer from 1 through 31",
    );
    expect(() => deriveUpcomingWeek([], "2026-08-07", 32)).toThrow(
      "integer from 1 through 31",
    );
  });
});

describe("deriveAgendaDayCounts", () => {
  test("uses agenda reasons without double-counting a task on one day", () => {
    const counts = deriveAgendaDayCounts(
      [
        makeTask("both", {
          scheduled: "2026-08-07",
          due: "2026-08-07",
        }),
        makeTask("planned-and-deadline", {
          scheduled: "2026-08-07",
          due: "2026-08-10",
        }),
      ],
      "2026-08-07",
    );

    expect([...counts]).toEqual([
      ["2026-08-07", 2],
      ["2026-08-10", 1],
    ]);
  });

  test("moves a completed date-less recurrence to its next open occurrence", () => {
    const counts = deriveAgendaDayCounts(
      [
        makeTask("weekly", {
          recurrence: "DTSTART:20260807;FREQ=WEEKLY",
          completeInstances: ["2026-08-07"],
        }),
        makeTask("done", { status: "done", due: "2026-08-08" }),
      ],
      "2026-08-07",
    );

    expect([...counts]).toEqual([["2026-08-14", 1]]);
  });
});
