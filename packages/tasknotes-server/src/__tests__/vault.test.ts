import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { scanVault } from "../vault/reader.ts";
import { writeTaskFile, deleteTaskFile, taskFilePath, generateId } from "../vault/writer.ts";
import type { Task } from "../domain/types.ts";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "tasknotes-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: generateId(),
    path: "",
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

describe("vault reader/writer", () => {
  test("write and read task round-trip", async () => {
    const task = makeTask({ title: "Round trip test", due: "2026-03-01" });
    const filePath = taskFilePath(tempDir, "", task);
    const relPath = path.basename(filePath);
    const storedTask = { ...task, path: relPath };

    await writeTaskFile(filePath, storedTask);

    const tasks = await scanVault(tempDir, "");
    expect(tasks.size).toBe(1);
    const loaded = tasks.values().next().value;
    expect(loaded.title).toBe("Round trip test");
    expect(loaded.due).toBe("2026-03-01");
    expect(loaded.status).toBe("open");
  });

  test("scan returns empty map for non-existent directory", async () => {
    const tasks = await scanVault(path.join(tempDir, "nonexistent"), "");
    expect(tasks.size).toBe(0);
  });

  test("write with tasksDir creates in subdirectory", async () => {
    const task = makeTask({ title: "Subdir task" });
    const filePath = taskFilePath(tempDir, "tasks", task);
    await writeTaskFile(filePath, task);

    const tasks = await scanVault(tempDir, "tasks");
    expect(tasks.size).toBe(1);
  });

  test("delete task file", async () => {
    const task = makeTask({ title: "Delete me" });
    const filePath = taskFilePath(tempDir, "", task);
    await writeTaskFile(filePath, task);

    await deleteTaskFile(filePath);
    const tasks = await scanVault(tempDir, "");
    expect(tasks.size).toBe(0);
  });

  test("delete non-existent file does not throw", async () => {
    await deleteTaskFile(path.join(tempDir, "nonexistent.md"));
  });

  test("skips files without task frontmatter", async () => {
    const notesDir = tempDir;
    await Bun.write(path.join(notesDir, "readme.md"), "# Just a readme\nNo frontmatter here.");
    const tasks = await scanVault(notesDir, "");
    expect(tasks.size).toBe(0);
  });

  test("skips hidden directories", async () => {
    await mkdir(path.join(tempDir, ".obsidian"), { recursive: true });
    await Bun.write(
      path.join(tempDir, ".obsidian", "task.md"),
      "---\nid: hidden\ntitle: Hidden\n---\n",
    );
    const tasks = await scanVault(tempDir, "");
    expect(tasks.size).toBe(0);
  });

  test("skips underscore directories", async () => {
    await mkdir(path.join(tempDir, "_templates"), { recursive: true });
    await Bun.write(
      path.join(tempDir, "_templates", "task.md"),
      "---\nid: template\ntitle: Template\n---\n",
    );
    const tasks = await scanVault(tempDir, "");
    expect(tasks.size).toBe(0);
  });
});
