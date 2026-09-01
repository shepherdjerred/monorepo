import { describe, expect, test } from "vitest";

import { TaskSchema } from "./schemas";

describe("TaskSchema", () => {
  test("applies the base task defaults before branding identifiers", () => {
    const task = TaskSchema.parse({
      id: "inbox/first.md",
      title: "First task",
    });

    expect(task.id).toBe("inbox/first.md");
    expect(task.path).toBe("");
    expect(task.title).toBe("First task");
    expect(task.status).toBe("open");
    expect(task.priority).toBe("normal");
    expect(task.contexts).toEqual([]);
    expect(task.projects).toEqual([]);
    expect(task.tags).toEqual([]);
    expect(task.completeInstances).toEqual([]);
    expect(task.skippedInstances).toEqual([]);
    expect(task.timeEntries).toEqual([]);
    expect(task.blockedBy).toEqual([]);
    expect(task.reminders).toEqual([]);
    expect(task.archived).toBe(false);
    expect(task.totalTrackedTime).toBe(0);
    expect(task.isBlocked).toBe(false);
    expect(task.isBlocking).toBe(false);
    expect(task.extraFields).toEqual({});
  });

  test("preserves complete collection values through the branded schema", () => {
    const task = TaskSchema.parse({
      id: "projects/plan.md",
      title: "Plan release",
      contexts: ["work"],
      projects: ["monorepo"],
      tags: ["release"],
      timeEntries: [{ startTime: "2026-09-01T00:00:00Z", duration: 30 }],
      blockedBy: [{ uid: "dependency.md", reltype: "blocks" }],
      reminders: [{ type: "relative", offset: "-PT15M" }],
    });

    expect(task.contexts).toEqual(["work"]);
    expect(task.projects).toEqual(["monorepo"]);
    expect(task.tags).toEqual(["release"]);
    expect(task.timeEntries).toEqual([
      { startTime: "2026-09-01T00:00:00Z", duration: 30 },
    ]);
    expect(task.blockedBy).toEqual([
      { uid: "dependency.md", reltype: "blocks" },
    ]);
    expect(task.reminders).toEqual([{ type: "relative", offset: "-PT15M" }]);
  });

  test("rejects invalid base task fields", () => {
    expect(() =>
      TaskSchema.parse({
        id: "inbox/invalid.md",
        title: "Invalid",
        status: "unknown",
      }),
    ).toThrow();
  });
});
