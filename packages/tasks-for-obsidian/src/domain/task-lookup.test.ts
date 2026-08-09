import { describe, expect, test } from "bun:test";

import { TaskSchema } from "./schemas";
import { findTaskByResolvedId } from "./task-lookup";
import { taskId } from "./types";

describe("findTaskByResolvedId", () => {
  test("keeps an open detail route alive after a temp ID is acknowledged", () => {
    const temporary = taskId("temp-create");
    const real = taskId("TaskNotes/created.md");
    const task = TaskSchema.parse({
      id: real,
      path: "TaskNotes/created.md",
      title: "Created task",
    });

    expect(
      findTaskByResolvedId(new Map([[real, task]]), () => real, temporary),
    ).toBe(task);
  });

  test("bridges a stale temp-id render snapshot during acknowledgement", () => {
    const temporary = taskId("temp-create");
    const real = taskId("TaskNotes/created.md");
    const optimisticTask = TaskSchema.parse({
      id: temporary,
      path: "temp-create",
      title: "Created task",
    });

    expect(
      findTaskByResolvedId(
        new Map([[temporary, optimisticTask]]),
        () => real,
        temporary,
      ),
    ).toBe(optimisticTask);
  });
});
