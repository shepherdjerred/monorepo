import { describe, expect, test } from "bun:test";

import {
  completionTargetDate,
  isCompletedOn,
  isRecurring,
  localTodayYmd,
  nextOptimistic,
  occursOn,
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

describe("completionTargetDate", () => {
  test("targets the scheduled instance (plugin parity), not the tap day", () => {
    const task = makeTask({
      recurrence: "FREQ=MONTHLY",
      scheduled: "2026-07-20",
      due: "2026-01-01",
    });
    expect(completionTargetDate(task)).toBe("2026-07-20");
  });

  test("falls back to due when there is no scheduled date", () => {
    const task = makeTask({ recurrence: "FREQ=MONTHLY", due: "2026-08-01" });
    expect(completionTargetDate(task)).toBe("2026-08-01");
  });

  test("completion-anchored rules target today", () => {
    const task = makeTask({
      recurrence: "FREQ=DAILY",
      recurrenceAnchor: "completion",
      scheduled: "2026-07-20",
    });
    expect(completionTargetDate(task)).toBe(localTodayYmd());
  });

  test("regression: completing a recurring task registers on its scheduled occurrence, not the tap day", () => {
    // Recurs on the 20th; `scheduled` points at the current instance. Tapping
    // "complete" on the 12th used to record `2026-07-12` — a non-occurrence
    // date the model never reads as done, so the task reappeared untouched.
    const task = makeTask({
      recurrence: "DTSTART:20260220;FREQ=MONTHLY;BYMONTHDAY=20",
      scheduled: "2026-07-20",
    });
    const tapDay = "2026-07-12";

    const target = completionTargetDate(task);
    expect(target).toBe("2026-07-20");
    expect(target).not.toBe(tapDay);

    // Recording the resolved target marks the occurrence complete...
    const fixed = toggleCompleteInstance(task, target);
    expect(isCompletedOn(fixed, "2026-07-20")).toBe(true);

    // ...while recording the raw tap day (the old behavior) does NOT.
    const orphaned = toggleCompleteInstance(task, tapDay);
    expect(isCompletedOn(orphaned, "2026-07-20")).toBe(false);
  });
});

describe("model-driven per-day semantics (P5)", () => {
  const base = makeTask();
  const recurring: Task = makeTask({
    recurrence: "FREQ=DAILY",
    scheduled: "2026-07-01",
    completeInstances: ["2026-07-02"],
  });

  test("isCompletedOn reflects the instance state per day", () => {
    expect(isCompletedOn(recurring, "2026-07-02")).toBe(true);
    expect(isCompletedOn(recurring, "2026-07-03")).toBe(false);
  });

  test("isCompletedOn for plain tasks is just the status", () => {
    expect(isCompletedOn({ ...base, status: "done" }, "2026-07-03")).toBe(true);
    expect(isCompletedOn(base, "2026-07-03")).toBe(false);
  });

  test("occursOn expands scheduled-anchored rules via the model", () => {
    const weekly: Task = makeTask({
      recurrence: "FREQ=WEEKLY;BYDAY=MO",
      scheduled: "2026-07-06", // a Monday
    });
    expect(occursOn(weekly, "2026-07-06")).toBe(true); // Monday
    expect(occursOn(weekly, "2026-07-07")).toBe(false); // Tuesday
    expect(occursOn(weekly, "2026-07-13")).toBe(true); // next Monday
    expect(occursOn(base, "2026-07-06")).toBe(false); // not recurring
  });

  test("a malformed day string fails fast instead of yielding an invalid Date", () => {
    const weekly: Task = makeTask({
      recurrence: "FREQ=WEEKLY;BYDAY=MO",
      scheduled: "2026-07-06",
    });
    expect(() => occursOn(weekly, "2026-07-xx")).toThrow(
      /invalid YYYY-MM-DD string/,
    );
    expect(() => isCompletedOn(weekly, "not-a-date")).toThrow(
      /invalid YYYY-MM-DD string/,
    );
  });
});
