import { describe, expect, test } from "bun:test";

import { frontmatterToTask, taskToFrontmatter } from "../vault/task-mapper.ts";
import type { Task } from "../domain/types.ts";

describe("frontmatterToTask", () => {
  test("parses valid frontmatter data", () => {
    const data = {
      id: "abc123",
      title: "Test task",
      status: "open",
      priority: "high",
      due: "2026-03-01",
      contexts: ["home"],
      projects: ["MyProject"],
      tags: ["urgent"],
    };

    const task = frontmatterToTask(data, "Description here", "tasks/test.md");
    expect(task).toBeDefined();
    expect(task!.id).toBe("abc123");
    expect(task!.title).toBe("Test task");
    expect(task!.status).toBe("open");
    expect(task!.priority).toBe("high");
    expect(task!.due).toBe("2026-03-01");
    expect(task!.contexts).toEqual(["home"]);
    expect(task!.projects).toEqual(["MyProject"]);
    expect(task!.tags).toEqual(["urgent"]);
    expect(task!.details).toBe("Description here");
    expect(task!.path).toBe("tasks/test.md");
  });

  test("uses defaults for missing fields", () => {
    const data = { id: "xyz", title: "Minimal" };
    const task = frontmatterToTask(data, "", "test.md");
    expect(task).toBeDefined();
    expect(task!.status).toBe("open");
    expect(task!.priority).toBe("normal");
    expect(task!.contexts).toEqual([]);
    expect(task!.projects).toEqual([]);
    expect(task!.tags).toEqual([]);
    expect(task!.archived).toBe(false);
    expect(task!.totalTrackedTime).toBe(0);
    expect(task!.details).toBeUndefined();
  });

  test("returns undefined for missing id", () => {
    const data = { title: "No ID" };
    const task = frontmatterToTask(data, "", "test.md");
    expect(task).toBeUndefined();
  });

  test("returns undefined for missing title", () => {
    const data = { id: "abc" };
    const task = frontmatterToTask(data, "", "test.md");
    expect(task).toBeUndefined();
  });
});

describe("taskToFrontmatter", () => {
  test("converts task to frontmatter", () => {
    const task: Task = {
      id: "abc123",
      path: "tasks/test.md",
      title: "Test task",
      status: "open",
      priority: "high",
      due: "2026-03-01",
      scheduled: undefined,
      contexts: ["home"],
      projects: ["MyProject"],
      tags: ["urgent"],
      recurrence: undefined,
      archived: false,
      totalTrackedTime: 0,
      isBlocked: false,
      isBlocking: false,
      details: "Task body",
    };

    const { data, content } = taskToFrontmatter(task);
    expect(data["id"]).toBe("abc123");
    expect(data["title"]).toBe("Test task");
    expect(data["status"]).toBe("open");
    expect(data["priority"]).toBe("high");
    expect(data["due"]).toBe("2026-03-01");
    expect(data["contexts"]).toEqual(["home"]);
    expect(data["projects"]).toEqual(["MyProject"]);
    expect(data["tags"]).toEqual(["urgent"]);
    expect(content).toBe("Task body");
  });

  test("omits undefined optional fields", () => {
    const task: Task = {
      id: "xyz",
      path: "test.md",
      title: "Minimal",
      status: "open",
      priority: "normal",
      contexts: [],
      projects: [],
      tags: [],
      archived: false,
      totalTrackedTime: 0,
      isBlocked: false,
      isBlocking: false,
    };

    const { data } = taskToFrontmatter(task);
    expect(data["due"]).toBeUndefined();
    expect(data["scheduled"]).toBeUndefined();
    expect(data["contexts"]).toBeUndefined();
    expect(data["projects"]).toBeUndefined();
    expect(data["tags"]).toBeUndefined();
    expect(data["recurrence"]).toBeUndefined();
    expect(data["archived"]).toBeUndefined();
  });
});
