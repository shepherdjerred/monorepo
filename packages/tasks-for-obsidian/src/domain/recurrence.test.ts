import { describe, expect, test } from "bun:test";

import {
  isRecurring,
  localTodayYmd,
  nextOptimistic,
  toggleCompleteInstance,
} from "./recurrence";
import type { Task } from "./types";
import { taskId } from "./types";

function makeTask(overrides: Partial<Task> = {}): Task {
  const base: Task = {
    id: taskId("task-1"),
    path: "tasks/task-1.md",
    title: "Test task",
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
  };
  return { ...base, ...overrides };
}

describe("localTodayYmd", () => {
  test("formats YYYY-MM-DD using local date", () => {
    const result = localTodayYmd(new Date(2026, 4, 10, 9, 30));
    expect(result).toBe("2026-05-10");
  });

  test("zero-pads month and day", () => {
    const result = localTodayYmd(new Date(2026, 0, 5, 12, 0));
    expect(result).toBe("2026-01-05");
  });

  test("uses local date components, not UTC", () => {
    const d = new Date(2026, 4, 10, 23, 45);
    expect(localTodayYmd(d)).toBe("2026-05-10");
  });
});

describe("isRecurring", () => {
  test("false when recurrence is undefined", () => {
    expect(isRecurring(makeTask())).toBe(false);
  });

  test("false when recurrence is empty string", () => {
    expect(isRecurring(makeTask({ recurrence: "" }))).toBe(false);
  });

  test("true when recurrence has a rule", () => {
    expect(isRecurring(makeTask({ recurrence: "FREQ=DAILY" }))).toBe(true);
  });
});

describe("toggleCompleteInstance", () => {
  test("adds today when not present", () => {
    const task = makeTask({ recurrence: "FREQ=DAILY" });
    const result = toggleCompleteInstance(task, "2026-05-10");
    expect(result.completeInstances).toEqual(["2026-05-10"]);
  });

  test("removes today when already present", () => {
    const task = makeTask({
      recurrence: "FREQ=DAILY",
      completeInstances: ["2026-05-09", "2026-05-10"],
    });
    const result = toggleCompleteInstance(task, "2026-05-10");
    expect(result.completeInstances).toEqual(["2026-05-09"]);
  });

  test("does not touch status", () => {
    const task = makeTask({ recurrence: "FREQ=DAILY", status: "open" });
    const result = toggleCompleteInstance(task, "2026-05-10");
    expect(result.status).toBe("open");
  });
});

describe("nextOptimistic", () => {
  test("non-recurring task: flips status open → done", () => {
    const task = makeTask({ status: "open" });
    const result = nextOptimistic(task, "2026-05-10");
    expect(result.status).toBe("done");
    expect(result.completeInstances).toEqual([]);
  });

  test("non-recurring task: flips status done → open", () => {
    const task = makeTask({ status: "done" });
    const result = nextOptimistic(task, "2026-05-10");
    expect(result.status).toBe("open");
  });

  test("recurring task: adds today and keeps status", () => {
    const task = makeTask({ recurrence: "FREQ=DAILY", status: "open" });
    const result = nextOptimistic(task, "2026-05-10");
    expect(result.status).toBe("open");
    expect(result.completeInstances).toEqual(["2026-05-10"]);
  });

  test("recurring task with today already: removes it", () => {
    const task = makeTask({
      recurrence: "FREQ=DAILY",
      completeInstances: ["2026-05-10"],
    });
    const result = nextOptimistic(task, "2026-05-10");
    expect(result.completeInstances).toEqual([]);
  });
});
