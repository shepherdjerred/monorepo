import { describe, expect, test } from "bun:test";

import { executeTaskToggle, recurringCompletionRestore } from "./task-toggle";
import { taskId } from "./types";
import type { Task } from "./types";
import type { RecurringCompletionRestore } from "tasknotes-types/v2";

function recurringTask(completeInstances: readonly string[]): Task {
  return {
    id: taskId("weekly"),
    path: "tasks/weekly.md",
    title: "Weekly",
    status: "open",
    priority: "normal",
    contexts: [],
    projects: [],
    tags: [],
    recurrence: "DTSTART:20260808;FREQ=WEEKLY",
    scheduled: "2026-08-08",
    completeInstances: [...completeInstances],
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
}

describe("executeTaskToggle", () => {
  test("completes the explicit occurrence represented by an unchecked row", async () => {
    const calls: { readonly date: string; readonly completed: boolean }[] = [];
    const execution = await executeTaskToggle(
      recurringTask([]),
      "2026-08-15",
      "occurrence",
      {
        toggleStatus: async () => "status",
        setInstanceComplete: async (date, completed) => {
          calls.push({ date, completed });
          return "instance";
        },
      },
    );

    expect(execution).toEqual({
      result: "instance",
      recurring: {
        date: "2026-08-15",
        completed: true,
        restore: {
          scheduled: "2026-08-08",
          due: null,
          recurrence: "DTSTART:20260808;FREQ=WEEKLY",
          skipped: false,
        },
      },
    });
    expect(calls).toEqual([{ date: "2026-08-15", completed: true }]);
  });

  test("uncompletes the same explicit occurrence represented by a checked row", async () => {
    const calls: { readonly date: string; readonly completed: boolean }[] = [];
    const execution = await executeTaskToggle(
      recurringTask(["2026-08-15"]),
      "2026-08-15",
      "occurrence",
      {
        toggleStatus: async () => "status",
        setInstanceComplete: async (date, completed) => {
          calls.push({ date, completed });
          return "instance";
        },
      },
    );

    expect(execution).toEqual({
      result: "instance",
      recurring: { date: "2026-08-15", completed: false, restore: null },
    });
    expect(calls).toEqual([{ date: "2026-08-15", completed: false }]);
  });

  test("passes a pending completion restore when unchecking offline", async () => {
    const restore = {
      scheduled: "2026-08-08",
      due: null,
      recurrence: "DTSTART:20260808;FREQ=WEEKLY",
      skipped: false,
    };
    let received: RecurringCompletionRestore | undefined;
    const execution = await executeTaskToggle(
      recurringTask(["2026-08-15"]),
      "2026-08-15",
      "occurrence",
      {
        toggleStatus: async () => "status",
        setInstanceComplete: async (_date, _completed, pendingRestore) => {
          received = pendingRestore;
          return "instance";
        },
        pendingRestore: restore,
      },
    );

    expect(received).toEqual(restore);
    expect(execution.recurring?.restore).toEqual(restore);
  });

  test("captures the exact recurrence fields needed by atomic Undo", () => {
    expect(
      recurringCompletionRestore(
        {
          ...recurringTask([]),
          due: "2026-08-10",
          skippedInstances: ["2026-08-08"],
        },
        "2026-08-08",
      ),
    ).toEqual({
      scheduled: "2026-08-08",
      due: "2026-08-10",
      recurrence: "DTSTART:20260808;FREQ=WEEKLY",
      skipped: true,
    });
  });

  test("uses the status workflow for a plain task", async () => {
    const task = { ...recurringTask([]), recurrence: undefined };
    let statusCalls = 0;
    const execution = await executeTaskToggle(task, undefined, "occurrence", {
      toggleStatus: async () => {
        statusCalls += 1;
        return "status";
      },
      setInstanceComplete: async () => "instance",
    });

    expect(execution).toEqual({ result: "status", recurring: null });
    expect(statusCalls).toBe(1);
  });

  test("uses the parent status workflow for a completed recurring task", async () => {
    const task = { ...recurringTask([]), status: "done" as const };
    let statusCalls = 0;
    let instanceCalls = 0;
    const execution = await executeTaskToggle(task, undefined, "task-status", {
      toggleStatus: async () => {
        statusCalls += 1;
        return "status";
      },
      setInstanceComplete: async () => {
        instanceCalls += 1;
        return "instance";
      },
    });

    expect(execution).toEqual({ result: "status", recurring: null });
    expect(statusCalls).toBe(1);
    expect(instanceCalls).toBe(0);
  });
});
