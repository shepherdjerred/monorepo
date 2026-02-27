import { describe, expect, test } from "bun:test";

import {
  DEFAULT_SORT,
  EMPTY_FILTER,
  applyFilter,
  applySort,
  countActiveFilters,
  isFilterActive,
} from "./filters";
import type { Task } from "./types";
import { contextName, projectName, tagName, taskId } from "./types";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: taskId("test-1"),
    path: "/tasks/test.md",
    title: "Test task",
    status: "open",
    priority: "normal",
    contexts: [],
    projects: [],
    tags: [],
    archived: false,
    totalTrackedTime: 0,
    isBlocked: false,
    isBlocking: false,
    ...overrides,
  };
}

describe("EMPTY_FILTER", () => {
  test("is an empty object", () => {
    expect(EMPTY_FILTER).toEqual({});
  });
});

describe("DEFAULT_SORT", () => {
  test("sorts by dueDate ascending", () => {
    expect(DEFAULT_SORT).toEqual({ field: "dueDate", direction: "asc" });
  });
});

describe("isFilterActive", () => {
  test("returns false for empty filter", () => {
    expect(isFilterActive({})).toBe(false);
  });

  test("returns false for filter with empty arrays", () => {
    expect(isFilterActive({ projects: [], contexts: [], tags: [], statuses: [], priorities: [] })).toBe(false);
  });

  test("returns true when projects is set", () => {
    expect(isFilterActive({ projects: ["Work"] })).toBe(true);
  });

  test("returns true when contexts is set", () => {
    expect(isFilterActive({ contexts: ["home"] })).toBe(true);
  });

  test("returns true when tags is set", () => {
    expect(isFilterActive({ tags: ["urgent"] })).toBe(true);
  });

  test("returns true when statuses is set", () => {
    expect(isFilterActive({ statuses: ["open"] })).toBe(true);
  });

  test("returns true when priorities is set", () => {
    expect(isFilterActive({ priorities: ["high"] })).toBe(true);
  });

  test("returns true when hasNoDueDate is true", () => {
    expect(isFilterActive({ hasNoDueDate: true })).toBe(true);
  });

  test("returns false when hasNoDueDate is false", () => {
    expect(isFilterActive({ hasNoDueDate: false })).toBe(false);
  });
});

describe("countActiveFilters", () => {
  test("returns 0 for empty filter", () => {
    expect(countActiveFilters({})).toBe(0);
  });

  test("counts each filter category as 1", () => {
    expect(countActiveFilters({ projects: ["A"], contexts: ["b"] })).toBe(2);
  });

  test("counts hasNoDueDate when true", () => {
    expect(countActiveFilters({ hasNoDueDate: true })).toBe(1);
  });

  test("does not count hasNoDueDate when false", () => {
    expect(countActiveFilters({ hasNoDueDate: false })).toBe(0);
  });

  test("counts all categories", () => {
    expect(
      countActiveFilters({
        projects: ["A"],
        contexts: ["b"],
        tags: ["c"],
        statuses: ["open"],
        priorities: ["high"],
        hasNoDueDate: true,
      }),
    ).toBe(6);
  });

  test("does not count empty arrays", () => {
    expect(countActiveFilters({ projects: [], contexts: ["home"] })).toBe(1);
  });
});

describe("applyFilter", () => {
  const tasks: Task[] = [
    makeTask({
      id: taskId("1"),
      title: "Work task",
      status: "open",
      priority: "high",
      projects: [projectName("Work")],
      contexts: [contextName("office")],
      tags: [tagName("urgent")],
      due: "2026-03-01",
    }),
    makeTask({
      id: taskId("2"),
      title: "Home task",
      status: "done",
      priority: "low",
      projects: [projectName("Home")],
      contexts: [contextName("home")],
      tags: [tagName("chores")],
    }),
    makeTask({
      id: taskId("3"),
      title: "No project task",
      status: "in-progress",
      priority: "medium",
    }),
  ];

  test("returns all tasks with empty filter", () => {
    expect(applyFilter(tasks, {})).toHaveLength(3);
  });

  test("filters by project", () => {
    const result = applyFilter(tasks, { projects: ["Work"] });
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("Work task");
  });

  test("filters by context", () => {
    const result = applyFilter(tasks, { contexts: ["home"] });
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("Home task");
  });

  test("filters by tag", () => {
    const result = applyFilter(tasks, { tags: ["urgent"] });
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("Work task");
  });

  test("filters by status", () => {
    const result = applyFilter(tasks, { statuses: ["done"] });
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("Home task");
  });

  test("filters by priority", () => {
    const result = applyFilter(tasks, { priorities: ["high"] });
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("Work task");
  });

  test("filters by hasNoDueDate", () => {
    const result = applyFilter(tasks, { hasNoDueDate: true });
    expect(result).toHaveLength(2);
    // Only tasks without due date
    for (const t of result) {
      expect(t.due).toBeUndefined();
    }
  });

  test("combines multiple filters (AND logic)", () => {
    const result = applyFilter(tasks, { statuses: ["open"], projects: ["Work"] });
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("Work task");
  });

  test("returns empty array when no tasks match", () => {
    const result = applyFilter(tasks, { projects: ["Nonexistent"] });
    expect(result).toHaveLength(0);
  });

  test("allows multiple values per filter (OR within category)", () => {
    const result = applyFilter(tasks, { statuses: ["open", "in-progress"] });
    expect(result).toHaveLength(2);
  });
});

describe("applySort", () => {
  const tasks: Task[] = [
    makeTask({ id: taskId("1"), title: "Banana", priority: "low", due: "2026-03-15" }),
    makeTask({ id: taskId("2"), title: "Apple", priority: "high", due: "2026-01-01" }),
    makeTask({ id: taskId("3"), title: "Cherry", priority: "medium" }),
  ];

  test("sorts by dueDate ascending (nulls last)", () => {
    const sorted = applySort(tasks, { field: "dueDate", direction: "asc" });
    expect(sorted[0]!.title).toBe("Apple");
    expect(sorted[1]!.title).toBe("Banana");
    expect(sorted[2]!.title).toBe("Cherry"); // no due date goes last
  });

  test("sorts by dueDate descending (nulls last)", () => {
    const sorted = applySort(tasks, { field: "dueDate", direction: "desc" });
    expect(sorted[0]!.title).toBe("Banana");
    expect(sorted[1]!.title).toBe("Apple");
    expect(sorted[2]!.title).toBe("Cherry"); // no due date still last
  });

  test("sorts by priority ascending (highest first)", () => {
    const sorted = applySort(tasks, { field: "priority", direction: "asc" });
    expect(sorted[0]!.priority).toBe("high");
    expect(sorted[1]!.priority).toBe("medium");
    expect(sorted[2]!.priority).toBe("low");
  });

  test("sorts by priority descending (lowest first)", () => {
    const sorted = applySort(tasks, { field: "priority", direction: "desc" });
    expect(sorted[0]!.priority).toBe("low");
    expect(sorted[1]!.priority).toBe("medium");
    expect(sorted[2]!.priority).toBe("high");
  });

  test("sorts by title ascending", () => {
    const sorted = applySort(tasks, { field: "title", direction: "asc" });
    expect(sorted.map((t) => t.title)).toEqual(["Apple", "Banana", "Cherry"]);
  });

  test("sorts by title descending", () => {
    const sorted = applySort(tasks, { field: "title", direction: "desc" });
    expect(sorted.map((t) => t.title)).toEqual(["Cherry", "Banana", "Apple"]);
  });

  test("does not mutate the original array", () => {
    const original = [...tasks];
    applySort(tasks, { field: "title", direction: "asc" });
    expect(tasks.map((t) => t.title)).toEqual(original.map((t) => t.title));
  });

  test("handles all tasks having no due date", () => {
    const noDueTasks = [
      makeTask({ id: taskId("a"), title: "A" }),
      makeTask({ id: taskId("b"), title: "B" }),
    ];
    const sorted = applySort(noDueTasks, { field: "dueDate", direction: "asc" });
    expect(sorted).toHaveLength(2);
  });
});
