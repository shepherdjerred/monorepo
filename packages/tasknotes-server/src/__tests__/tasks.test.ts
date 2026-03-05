import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { TaskStore } from "../store/task-store.ts";

let tempDir: string;
let store: TaskStore;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "tasknotes-tasks-"));
  store = new TaskStore(tempDir, "");
  await store.init();
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("TaskStore.create", () => {
  test("creates a task with defaults", async () => {
    const task = await store.create({ title: "Buy groceries" });
    expect(task.id).toBeDefined();
    expect(task.title).toBe("Buy groceries");
    expect(task.status).toBe("open");
    expect(task.priority).toBe("normal");
    expect(task.contexts).toEqual([]);
    expect(task.projects).toEqual([]);
    expect(task.tags).toEqual([]);
    expect(task.archived).toBe(false);
    expect(task.totalTrackedTime).toBe(0);
    expect(task.isBlocked).toBe(false);
    expect(task.isBlocking).toBe(false);
  });

  test("creates a task with all fields", async () => {
    const task = await store.create({
      title: "Fix bug",
      details: "Fix the login bug",
      status: "in-progress",
      priority: "high",
      due: "2026-03-01",
      scheduled: "2026-02-28",
      contexts: ["work"],
      projects: ["Backend"],
      tags: ["urgent"],
      recurrence: "every week",
      timeEstimate: 3600,
    });
    expect(task.title).toBe("Fix bug");
    expect(task.details).toBe("Fix the login bug");
    expect(task.status).toBe("in-progress");
    expect(task.priority).toBe("high");
    expect(task.due).toBe("2026-03-01");
    expect(task.scheduled).toBe("2026-02-28");
    expect(task.contexts).toEqual(["work"]);
    expect(task.projects).toEqual(["Backend"]);
    expect(task.tags).toEqual(["urgent"]);
    expect(task.recurrence).toBe("every week");
  });

  test("generates unique IDs", async () => {
    const task1 = await store.create({ title: "Task 1" });
    const task2 = await store.create({ title: "Task 2" });
    expect(task1.id).not.toBe(task2.id);
  });

  test("sets a relative file path", async () => {
    const task = await store.create({ title: "Path test" });
    expect(task.path).toBeDefined();
    expect(task.path.endsWith(".md")).toBe(true);
  });
});

describe("TaskStore.getById", () => {
  test("returns task by ID", async () => {
    const created = await store.create({ title: "Find me" });
    const found = store.getById(created.id);
    expect(found).toBeDefined();
    expect(found?.title).toBe("Find me");
  });

  test("returns undefined for non-existent ID", () => {
    const found = store.getById("nonexistent");
    expect(found).toBeUndefined();
  });
});

describe("TaskStore.getAll", () => {
  test("returns empty list initially", () => {
    const { tasks, total } = store.getAll();
    expect(tasks).toEqual([]);
    expect(total).toBe(0);
  });

  test("returns all non-archived tasks", async () => {
    await store.create({ title: "Task 1" });
    await store.create({ title: "Task 2" });
    const { tasks, total } = store.getAll();
    expect(tasks).toHaveLength(2);
    expect(total).toBe(2);
  });

  test("paginates with limit and offset", async () => {
    await store.create({ title: "Task A" });
    await store.create({ title: "Task B" });
    await store.create({ title: "Task C" });

    const page1 = store.getAll(2, 0);
    expect(page1.tasks).toHaveLength(2);
    expect(page1.total).toBe(3);

    const page2 = store.getAll(2, 2);
    expect(page2.tasks).toHaveLength(1);
    expect(page2.total).toBe(3);
  });

  test("excludes archived tasks", async () => {
    const task = await store.create({ title: "Archive me" });
    await store.archive(task.id);
    const { tasks, total } = store.getAll();
    expect(tasks).toHaveLength(0);
    expect(total).toBe(0);
  });
});

describe("TaskStore.update", () => {
  test("updates task fields", async () => {
    const created = await store.create({ title: "Original" });
    const updated = await store.update(created.id, {
      title: "Updated",
      priority: "high",
    });
    expect(updated).toBeDefined();
    expect(updated?.title).toBe("Updated");
    expect(updated?.priority).toBe("high");
  });

  test("clears optional fields with null", async () => {
    const created = await store.create({
      title: "Has due",
      due: "2026-03-01",
      scheduled: "2026-02-28",
    });
    const updated = await store.update(created.id, {
      due: null,
      scheduled: null,
    });
    expect(updated?.due).toBeUndefined();
    expect(updated?.scheduled).toBeUndefined();
  });

  test("preserves fields not in update", async () => {
    const created = await store.create({
      title: "Keep me",
      priority: "high",
      due: "2026-03-01",
    });
    const updated = await store.update(created.id, { title: "Changed" });
    expect(updated?.title).toBe("Changed");
    expect(updated?.priority).toBe("high");
    expect(updated?.due).toBe("2026-03-01");
  });

  test("returns undefined for non-existent task", async () => {
    const result = await store.update("nonexistent", { title: "Nope" });
    expect(result).toBeUndefined();
  });
});

describe("TaskStore.delete", () => {
  test("deletes a task", async () => {
    const created = await store.create({ title: "Delete me" });
    const deleted = await store.delete(created.id);
    expect(deleted).toBe(true);
    expect(store.getById(created.id)).toBeUndefined();
  });

  test("returns false for non-existent task", async () => {
    const deleted = await store.delete("nonexistent");
    expect(deleted).toBe(false);
  });
});

describe("TaskStore.archive", () => {
  test("archives a task", async () => {
    const created = await store.create({ title: "Archive me" });
    const archived = await store.archive(created.id);
    expect(archived).toBe(true);

    const task = store.getById(created.id);
    expect(task?.archived).toBe(true);
  });

  test("returns false for non-existent task", async () => {
    const archived = await store.archive("nonexistent");
    expect(archived).toBe(false);
  });
});

describe("TaskStore.query", () => {
  test("filters by status", async () => {
    await store.create({ title: "Open task" });
    await store.create({ title: "Done task", status: "done" });

    const { tasks } = store.query({ status: ["open"] });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe("Open task");
  });

  test("filters by priority", async () => {
    await store.create({ title: "High", priority: "high" });
    await store.create({ title: "Low", priority: "low" });

    const { tasks } = store.query({ priority: ["high"] });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe("High");
  });

  test("filters by project", async () => {
    await store.create({ title: "Project A", projects: ["Alpha"] });
    await store.create({ title: "Project B", projects: ["Beta"] });

    const { tasks } = store.query({ projects: ["Alpha"] });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe("Project A");
  });

  test("filters by context", async () => {
    await store.create({ title: "At home", contexts: ["home"] });
    await store.create({ title: "At work", contexts: ["work"] });

    const { tasks } = store.query({ contexts: ["home"] });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe("At home");
  });

  test("filters by tag", async () => {
    await store.create({ title: "Urgent", tags: ["urgent"] });
    await store.create({ title: "Normal", tags: ["routine"] });

    const { tasks } = store.query({ tags: ["urgent"] });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe("Urgent");
  });

  test("filters by dueBefore", async () => {
    await store.create({ title: "Early", due: "2026-01-15" });
    await store.create({ title: "Late", due: "2026-06-15" });

    const { tasks } = store.query({ dueBefore: "2026-03-01" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe("Early");
  });

  test("filters by dueAfter", async () => {
    await store.create({ title: "Early", due: "2026-01-15" });
    await store.create({ title: "Late", due: "2026-06-15" });

    const { tasks } = store.query({ dueAfter: "2026-03-01" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe("Late");
  });

  test("filters by hasNoDueDate", async () => {
    await store.create({ title: "Has due", due: "2026-03-01" });
    await store.create({ title: "No due" });

    const { tasks } = store.query({ hasNoDueDate: true });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe("No due");
  });

  test("filters by hasNoProject", async () => {
    await store.create({ title: "Has project", projects: ["Alpha"] });
    await store.create({ title: "No project" });

    const { tasks } = store.query({ hasNoProject: true });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe("No project");
  });

  test("filters by search text in title", async () => {
    await store.create({ title: "Buy groceries" });
    await store.create({ title: "Fix bug" });

    const { tasks } = store.query({ search: "groceries" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe("Buy groceries");
  });

  test("filters by search text in details", async () => {
    await store.create({ title: "Task", details: "Important details here" });
    await store.create({ title: "Other task", details: "Nothing relevant" });

    const { tasks } = store.query({ search: "important" });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe("Task");
  });

  test("returns total count matching filter", async () => {
    await store.create({ title: "Open 1" });
    await store.create({ title: "Open 2" });
    await store.create({ title: "Done", status: "done" });

    const { total } = store.query({ status: ["open"] });
    expect(total).toBe(2);
  });

  test("combines multiple filters", async () => {
    await store.create({
      title: "Match",
      status: "open",
      priority: "high",
      projects: ["Alpha"],
    });
    await store.create({
      title: "Wrong status",
      status: "done",
      priority: "high",
      projects: ["Alpha"],
    });
    await store.create({
      title: "Wrong priority",
      status: "open",
      priority: "low",
      projects: ["Alpha"],
    });

    const { tasks } = store.query({
      status: ["open"],
      priority: ["high"],
      projects: ["Alpha"],
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe("Match");
  });
});

describe("TaskStore.getStats", () => {
  test("returns stats for empty store", () => {
    const stats = store.getStats();
    expect(stats.total).toBe(0);
    expect(stats.completed).toBe(0);
    expect(stats.active).toBe(0);
    expect(stats.overdue).toBe(0);
    expect(stats.archived).toBe(0);
    expect(stats.withTimeTracking).toBe(0);
  });

  test("counts completed and active tasks", async () => {
    await store.create({ title: "Open 1" });
    await store.create({ title: "Open 2" });
    await store.create({ title: "Done", status: "done" });

    const stats = store.getStats();
    expect(stats.total).toBe(3);
    expect(stats.active).toBe(2);
    expect(stats.completed).toBe(1);
  });

  test("counts archived tasks", async () => {
    const task = await store.create({ title: "Archive me" });
    await store.archive(task.id);

    const stats = store.getStats();
    expect(stats.archived).toBe(1);
  });

  test("counts overdue tasks", async () => {
    await store.create({ title: "Overdue", due: "2020-01-01" });
    await store.create({ title: "Future", due: "2099-12-31" });

    const stats = store.getStats();
    expect(stats.overdue).toBe(1);
  });

  test("does not count done tasks as overdue", async () => {
    await store.create({
      title: "Done overdue",
      due: "2020-01-01",
      status: "done",
    });
    const stats = store.getStats();
    expect(stats.overdue).toBe(0);
  });
});

describe("TaskStore.getFilterOptions", () => {
  test("returns empty filter options for empty store", () => {
    const options = store.getFilterOptions();
    expect(options.projects).toEqual([]);
    expect(options.contexts).toEqual([]);
    expect(options.tags).toEqual([]);
    expect(options.statuses).toBeDefined();
    expect(options.priorities).toBeDefined();
  });

  test("collects unique projects, contexts, and tags", async () => {
    await store.create({
      title: "T1",
      contexts: ["home", "work"],
      projects: ["Alpha"],
      tags: ["urgent"],
    });
    await store.create({
      title: "T2",
      contexts: ["work"],
      projects: ["Beta"],
      tags: ["urgent", "review"],
    });

    const options = store.getFilterOptions();
    expect(options.projects).toEqual(["Alpha", "Beta"]);
    expect(options.contexts).toEqual(["home", "work"]);
    expect(options.tags).toEqual(["review", "urgent"]);
  });

  test("returns sorted filter options", async () => {
    await store.create({
      title: "T1",
      projects: ["Zeta"],
      contexts: ["zebra"],
      tags: ["zoo"],
    });
    await store.create({
      title: "T2",
      projects: ["Alpha"],
      contexts: ["apple"],
      tags: ["ant"],
    });

    const options = store.getFilterOptions();
    expect(options.projects).toEqual(["Alpha", "Zeta"]);
    expect(options.contexts).toEqual(["apple", "zebra"]);
    expect(options.tags).toEqual(["ant", "zoo"]);
  });
});

describe("TaskStore.completeRecurring", () => {
  test("marks task as done", async () => {
    const created = await store.create({
      title: "Weekly",
      recurrence: "every week",
    });
    const completed = await store.completeRecurring(created.id);
    expect(completed).toBeDefined();
    expect(completed?.status).toBe("done");
  });

  test("returns undefined for non-existent task", async () => {
    const result = await store.completeRecurring("nonexistent");
    expect(result).toBeUndefined();
  });
});

describe("TaskStore persistence", () => {
  test("tasks persist across init calls", async () => {
    await store.create({ title: "Persistent" });

    const store2 = new TaskStore(tempDir, "");
    await store2.init();
    const { tasks } = store2.getAll();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe("Persistent");
  });
});
