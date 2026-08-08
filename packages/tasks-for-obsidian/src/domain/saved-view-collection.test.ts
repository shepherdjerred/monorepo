import { describe, expect, test } from "bun:test";

import {
  deriveSavedViewTasks,
  filterTasksForSavedView,
  savedViewGroupLabel,
} from "./saved-view-collection";
import { SavedViewSchema } from "./saved-views";
import type { SavedView, SavedViewQuery } from "./saved-views";
import { contextName, projectName, tagName, taskId } from "./types";
import type { Task } from "./types";

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id: taskId(id),
    path: `${id}.md`,
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
}

function query(overrides: Partial<SavedViewQuery> = {}): SavedViewQuery {
  return {
    projects: [],
    contexts: [],
    tags: [],
    statuses: [],
    priorities: [],
    completed: "active",
    missingFields: [],
    ...overrides,
  };
}

function view(overrides: Partial<SavedView> = {}): SavedView {
  return SavedViewSchema.parse({
    id: "test-view",
    name: "Test View",
    symbol: "tray",
    tint: "#0a84ff",
    favorite: false,
    order: 0,
    query: query(),
    presentation: {
      layout: "list",
      sort: { field: "deadline", direction: "ascending" },
      group: "none",
    },
    ...overrides,
  });
}

describe("filterTasksForSavedView", () => {
  test("applies project, context, tag, status, priority, and text predicates", () => {
    const matching = makeTask("matching", {
      title: "Ship launch plan",
      projects: [projectName("[[Work]]")],
      contexts: [contextName("desk")],
      tags: [tagName("focus")],
      status: "in-progress",
      priority: "high",
    });
    const tasks = [
      matching,
      makeTask("wrong-project", {
        title: matching.title,
        projects: [projectName("Home")],
        contexts: matching.contexts,
        tags: matching.tags,
        status: matching.status,
        priority: matching.priority,
      }),
    ];

    expect(
      filterTasksForSavedView(
        tasks,
        query({
          projects: ["Work"],
          contexts: ["desk"],
          tags: ["focus"],
          statuses: ["in-progress"],
          priorities: ["high"],
          text: "LAUNCH",
        }),
        "2026-08-08",
      ).map((task) => task.id),
    ).toEqual([taskId("matching")]);
  });

  test("distinguishes active, completed, and all tasks", () => {
    const tasks = [
      makeTask("active"),
      makeTask("done", { status: "done" }),
      makeTask("cancelled", { status: "cancelled" }),
    ];

    expect(
      filterTasksForSavedView(tasks, query(), "2026-08-08").map(
        (task) => task.id,
      ),
    ).toEqual([taskId("active")]);
    expect(
      filterTasksForSavedView(
        tasks,
        query({ completed: "completed" }),
        "2026-08-08",
      ).map((task) => task.id),
    ).toEqual([taskId("done"), taskId("cancelled")]);
    expect(
      filterTasksForSavedView(tasks, query({ completed: "all" }), "2026-08-08"),
    ).toHaveLength(3);
  });

  test("applies missing-field and relative date predicates", () => {
    const tasks = [
      makeTask("match", {
        scheduled: "2026-08-10",
        due: "2026-08-15",
      }),
      makeTask("has-project", {
        projects: [projectName("Work")],
        scheduled: "2026-08-10",
        due: "2026-08-15",
      }),
      makeTask("too-late", {
        scheduled: "2026-08-20",
        due: "2026-08-15",
      }),
    ];

    expect(
      filterTasksForSavedView(
        tasks,
        query({
          missingFields: ["project"],
          scheduled: { startOffsetDays: 0, endOffsetDays: 7 },
          deadline: { endOffsetDays: 14 },
        }),
        "2026-08-08",
      ).map((task) => task.id),
    ).toEqual([taskId("match")]);
  });

  test("fails loudly for malformed task dates", () => {
    expect(() =>
      filterTasksForSavedView(
        [makeTask("broken", { scheduled: "not-a-date" })],
        query({ scheduled: { startOffsetDays: 0 } }),
        "2026-08-08",
      ),
    ).toThrow("Invalid scheduled date");
  });
});

describe("saved-view presentation", () => {
  test("sorts by the persisted presentation with deterministic ties", () => {
    const tasks = [
      makeTask("later", { title: "Beta", due: "2026-08-12" }),
      makeTask("same-b", { title: "Bravo", due: "2026-08-10" }),
      makeTask("same-a", { title: "Alpha", due: "2026-08-10" }),
      makeTask("undated", { title: "Undated" }),
    ];

    expect(
      deriveSavedViewTasks(tasks, view(), "2026-08-08").map((task) => task.id),
    ).toEqual([
      taskId("same-a"),
      taskId("same-b"),
      taskId("later"),
      taskId("undated"),
    ]);
  });

  test("uses explicit planned and deadline group labels", () => {
    const task = makeTask("dated", {
      projects: [projectName("[[Work]]")],
      contexts: [contextName("desk")],
      scheduled: "2026-08-09",
      due: "2026-08-10",
    });

    expect(savedViewGroupLabel(task, "scheduled")).toBe("Planned · 2026-08-09");
    expect(savedViewGroupLabel(task, "deadline")).toBe("Deadline · 2026-08-10");
    expect(savedViewGroupLabel(task, "project")).toBe("Work");
    expect(savedViewGroupLabel(task, "context")).toBe("@desk");
  });
});
