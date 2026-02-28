import { describe, expect, test } from "bun:test";

import { parseFrontmatter, serializeFrontmatter } from "../vault/frontmatter.ts";
import { frontmatterToTask, taskToFrontmatter } from "../vault/task-mapper.ts";
import type { Task } from "../domain/types.ts";

describe("parseFrontmatter", () => {
  test("parses YAML frontmatter", () => {
    const raw = `---
id: "abc123"
title: "Test task"
status: "open"
---
Description here.`;

    const result = parseFrontmatter(raw);
    expect(result.data["id"]).toBe("abc123");
    expect(result.data["title"]).toBe("Test task");
    expect(result.data["status"]).toBe("open");
    expect(result.content).toBe("Description here.");
  });

  test("handles empty body", () => {
    const raw = `---
id: "abc"
title: "No body"
---`;

    const result = parseFrontmatter(raw);
    expect(result.data["id"]).toBe("abc");
    expect(result.content).toBe("");
  });

  test("handles arrays in frontmatter", () => {
    const raw = `---
id: "t1"
title: "Tagged task"
tags:
  - urgent
  - review
---`;

    const result = parseFrontmatter(raw);
    expect(result.data["tags"]).toEqual(["urgent", "review"]);
  });

  test("handles multiline body content", () => {
    const raw = `---
id: "t1"
title: "Multi"
---
Line one.

Line two.

Line three.`;

    const result = parseFrontmatter(raw);
    expect(result.content).toContain("Line one.");
    expect(result.content).toContain("Line two.");
    expect(result.content).toContain("Line three.");
  });
});

describe("serializeFrontmatter", () => {
  test("serializes data with content", () => {
    const data = { id: "abc", title: "Test" };
    const result = serializeFrontmatter(data, "Body text");
    expect(result).toContain("id: abc");
    expect(result).toContain("title: Test");
    expect(result).toContain("Body text");
  });

  test("serializes data without content", () => {
    const data = { id: "abc", title: "Test" };
    const result = serializeFrontmatter(data, "");
    expect(result).toContain("id: abc");
    expect(result).toContain("title: Test");
  });

  test("serializes arrays", () => {
    const data = { id: "abc", tags: ["urgent", "review"] };
    const result = serializeFrontmatter(data, "");
    expect(result).toContain("urgent");
    expect(result).toContain("review");
  });

  test("output starts with --- and ends with newline", () => {
    const data = { id: "abc" };
    const result = serializeFrontmatter(data, "");
    expect(result.startsWith("---")).toBe(true);
    expect(result.endsWith("\n")).toBe(true);
  });
});

describe("parseFrontmatter round-trip", () => {
  test("serialize then parse preserves data", () => {
    const data = {
      id: "round-trip-1",
      title: "Round trip test",
      status: "open",
      priority: "high",
    };
    const content = "Description body";

    const serialized = serializeFrontmatter(data, content);
    const parsed = parseFrontmatter(serialized);

    expect(parsed.data["id"]).toBe("round-trip-1");
    expect(parsed.data["title"]).toBe("Round trip test");
    expect(parsed.data["status"]).toBe("open");
    expect(parsed.data["priority"]).toBe("high");
    expect(parsed.content).toBe("Description body");
  });

  test("serialize then parse preserves arrays", () => {
    const data = {
      id: "rt-arrays",
      contexts: ["home", "work"],
      projects: ["Alpha"],
      tags: ["urgent", "review"],
    };

    const serialized = serializeFrontmatter(data, "");
    const parsed = parseFrontmatter(serialized);

    expect(parsed.data["contexts"]).toEqual(["home", "work"]);
    expect(parsed.data["projects"]).toEqual(["Alpha"]);
    expect(parsed.data["tags"]).toEqual(["urgent", "review"]);
  });

  test("serialize then parse preserves boolean values", () => {
    const data = { id: "rt-bools", archived: true, isBlocked: false };

    const serialized = serializeFrontmatter(data, "");
    const parsed = parseFrontmatter(serialized);

    expect(parsed.data["archived"]).toBe(true);
    expect(parsed.data["isBlocked"]).toBe(false);
  });
});

describe("frontmatterToTask", () => {
  test("maps all fields from frontmatter to task", () => {
    const data = {
      id: "abc123",
      title: "Full task",
      status: "in-progress",
      priority: "high",
      due: "2026-03-01",
      scheduled: "2026-02-28",
      contexts: ["work"],
      projects: ["Backend"],
      tags: ["urgent"],
      recurrence: "every week",
      archived: true,
      totalTrackedTime: 3600,
      isBlocked: true,
      isBlocking: false,
    };

    const task = frontmatterToTask(data, "Task body", "tasks/full.md");
    expect(task).toBeDefined();
    expect(task?.id).toBe("abc123");
    expect(task?.title).toBe("Full task");
    expect(task?.status).toBe("in-progress");
    expect(task?.priority).toBe("high");
    expect(task?.due).toBe("2026-03-01");
    expect(task?.scheduled).toBe("2026-02-28");
    expect(task?.contexts).toEqual(["work"]);
    expect(task?.projects).toEqual(["Backend"]);
    expect(task?.tags).toEqual(["urgent"]);
    expect(task?.recurrence).toBe("every week");
    expect(task?.archived).toBe(true);
    expect(task?.totalTrackedTime).toBe(3600);
    expect(task?.isBlocked).toBe(true);
    expect(task?.isBlocking).toBe(false);
    expect(task?.details).toBe("Task body");
    expect(task?.path).toBe("tasks/full.md");
  });

  test("applies defaults for missing optional fields", () => {
    const data = { id: "min", title: "Minimal" };
    const task = frontmatterToTask(data, "", "test.md");
    expect(task).toBeDefined();
    expect(task?.status).toBe("open");
    expect(task?.priority).toBe("normal");
    expect(task?.contexts).toEqual([]);
    expect(task?.projects).toEqual([]);
    expect(task?.tags).toEqual([]);
    expect(task?.archived).toBe(false);
    expect(task?.totalTrackedTime).toBe(0);
    expect(task?.isBlocked).toBe(false);
    expect(task?.isBlocking).toBe(false);
  });

  test("returns undefined for missing id", () => {
    const task = frontmatterToTask({ title: "No ID" }, "", "test.md");
    expect(task).toBeUndefined();
  });

  test("returns undefined for missing title", () => {
    const task = frontmatterToTask({ id: "abc" }, "", "test.md");
    expect(task).toBeUndefined();
  });

  test("returns undefined for invalid status", () => {
    const task = frontmatterToTask({ id: "abc", title: "Bad", status: "invalid" }, "", "test.md");
    expect(task).toBeUndefined();
  });

  test("returns undefined for invalid priority", () => {
    const task = frontmatterToTask({ id: "abc", title: "Bad", priority: "invalid" }, "", "test.md");
    expect(task).toBeUndefined();
  });

  test("sets details to undefined for empty body", () => {
    const task = frontmatterToTask({ id: "abc", title: "No body" }, "", "test.md");
    expect(task?.details).toBeUndefined();
  });
});

describe("taskToFrontmatter", () => {
  test("maps all fields from task to frontmatter", () => {
    const task: Task = {
      id: "abc123",
      path: "tasks/test.md",
      title: "Test task",
      status: "open",
      priority: "high",
      due: "2026-03-01",
      scheduled: "2026-02-28",
      contexts: ["home"],
      projects: ["MyProject"],
      tags: ["urgent"],
      recurrence: "every day",
      archived: true,
      totalTrackedTime: 1800,
      isBlocked: true,
      isBlocking: true,
      details: "Task body",
    };

    const { data, content } = taskToFrontmatter(task);
    expect(data["id"]).toBe("abc123");
    expect(data["title"]).toBe("Test task");
    expect(data["status"]).toBe("open");
    expect(data["priority"]).toBe("high");
    expect(data["due"]).toBe("2026-03-01");
    expect(data["scheduled"]).toBe("2026-02-28");
    expect(data["contexts"]).toEqual(["home"]);
    expect(data["projects"]).toEqual(["MyProject"]);
    expect(data["tags"]).toEqual(["urgent"]);
    expect(data["recurrence"]).toBe("every day");
    expect(data["archived"]).toBe(true);
    expect(data["totalTrackedTime"]).toBe(1800);
    expect(data["isBlocked"]).toBe(true);
    expect(data["isBlocking"]).toBe(true);
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
    expect(data["totalTrackedTime"]).toBeUndefined();
    expect(data["isBlocked"]).toBeUndefined();
    expect(data["isBlocking"]).toBeUndefined();
  });

  test("returns empty string content for task without details", () => {
    const task: Task = {
      id: "xyz",
      path: "test.md",
      title: "No desc",
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

    const { content } = taskToFrontmatter(task);
    expect(content).toBe("");
  });
});

describe("frontmatterToTask -> taskToFrontmatter round-trip", () => {
  test("task survives round-trip through frontmatter", () => {
    const originalData = {
      id: "rt-task",
      title: "Round trip task",
      status: "in-progress",
      priority: "high",
      due: "2026-05-01",
      contexts: ["work"],
      projects: ["Backend"],
      tags: ["urgent"],
    };

    const task = frontmatterToTask(originalData, "Some details", "tasks/rt.md");
    expect(task).toBeDefined();

    const { data, content } = taskToFrontmatter(task!);

    const reconstructed = frontmatterToTask(data, content, "tasks/rt.md");
    expect(reconstructed).toBeDefined();
    expect(reconstructed?.id).toBe(task?.id);
    expect(reconstructed?.title).toBe(task?.title);
    expect(reconstructed?.status).toBe(task?.status);
    expect(reconstructed?.priority).toBe(task?.priority);
    expect(reconstructed?.due).toBe(task?.due);
    expect(reconstructed?.contexts).toEqual(task?.contexts);
    expect(reconstructed?.projects).toEqual(task?.projects);
    expect(reconstructed?.tags).toEqual(task?.tags);
    expect(reconstructed?.details).toBe(task?.details);
  });
});
