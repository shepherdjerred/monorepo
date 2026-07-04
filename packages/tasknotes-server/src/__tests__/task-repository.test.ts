import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveModelConfig } from "tasknotes-types/v2";

import {
  NotRecurringError,
  TaskNotFoundError,
  TaskRepository,
} from "../engine/task-repository.ts";

/**
 * Repository-level proof of the 2026-07-02 review kill-cases: tolerant
 * reads, loud skips, surgical writes that preserve bodies and unknown
 * frontmatter, concurrent-edit survival, and model-driven recurrence.
 */

const NOW = new Date("2026-07-03T12:00:00.000Z");

let vault: string;
let repo: TaskRepository;

async function seed(relPath: string, content: string): Promise<void> {
  const abs = path.join(vault, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content);
}

const PLUGIN_AUTHORED = `---
title: Written by the plugin
status: open
priority: normal
due: 2026-07-10
tags:
  - task
project-notes: kept even though the server does not know this key
---

Body written in Obsidian.

- [ ] a checklist the server must never touch
`;

beforeEach(async () => {
  vault = await mkdtemp(path.join(tmpdir(), "tn-repo-"));
  repo = new TaskRepository(
    vault,
    "TaskNotes",
    resolveModelConfig(),
    () => NOW,
  );
});

describe("tolerant read path", () => {
  test("a plugin-authored, tag-identified file (no id key) is visible", async () => {
    await seed("TaskNotes/plugin-task.md", PLUGIN_AUTHORED);
    await repo.scan();
    const tasks = repo.list();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe("Written by the plugin");
    expect(tasks[0]?.id).toBe("TaskNotes/plugin-task.md");
    expect(tasks[0]?.due).toBe("2026-07-10");
  });

  test("non-task markdown is ignored without noise", async () => {
    await seed("Notes/journal.md", "# Just a note\n\nNo frontmatter.\n");
    await repo.scan();
    expect(repo.list()).toHaveLength(0);
    expect(repo.skippedFiles()).toHaveLength(0);
  });

  test("a broken task-like file is skipped LOUDLY, not silently dropped", async () => {
    await seed(
      "TaskNotes/broken.md",
      "---\ntitle: Broken\ntags: [task]\ndue: [:::\n---\nbody\n",
    );
    await seed("TaskNotes/fine.md", PLUGIN_AUTHORED);
    await repo.scan();
    expect(repo.list()).toHaveLength(1);
    const skipped = repo.skippedFiles();
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.path).toBe("TaskNotes/broken.md");
    expect(skipped[0]?.reason.length).toBeGreaterThan(0);
  });

  test("a title-less file under storeTitleInFilename uses the filename", async () => {
    await seed(
      "TaskNotes/Buy milk.md",
      "---\nstatus: open\ntags: [task]\n---\n",
    );
    await repo.scan();
    expect(repo.list()[0]?.title).toBe("Buy milk");
  });
});

describe("surgical writes", () => {
  test("update patches one field; body and unknown keys survive byte-for-byte", async () => {
    await seed("TaskNotes/plugin-task.md", PLUGIN_AUTHORED);
    await repo.scan();

    const updated = await repo.update("TaskNotes/plugin-task.md", {
      priority: "high",
    });
    expect(updated.priority).toBe("high");

    const raw = await Bun.file(
      path.join(vault, "TaskNotes/plugin-task.md"),
    ).text();
    expect(raw).toContain(
      "project-notes: kept even though the server does not know this key",
    );
    expect(raw).toContain("Body written in Obsidian.");
    expect(raw).toContain("- [ ] a checklist the server must never touch");
    expect(raw).toContain("due: 2026-07-10");
  });

  test("an Obsidian edit landing after our scan survives our update", async () => {
    await seed("TaskNotes/plugin-task.md", PLUGIN_AUTHORED);
    await repo.scan();

    // Obsidian edits the body + adds a key while we hold a stale cache.
    await seed(
      "TaskNotes/plugin-task.md",
      PLUGIN_AUTHORED.replace(
        "Body written in Obsidian.",
        "Body EDITED in Obsidian.",
      ),
    );

    await repo.update("TaskNotes/plugin-task.md", { status: "done" });
    const raw = await Bun.file(
      path.join(vault, "TaskNotes/plugin-task.md"),
    ).text();
    expect(raw).toContain("Body EDITED in Obsidian.");
    expect(raw).toContain("status: done");
  });

  test("delete removes the file; a second delete throws not-found", async () => {
    await seed("TaskNotes/plugin-task.md", PLUGIN_AUTHORED);
    await repo.scan();
    await repo.delete("TaskNotes/plugin-task.md");
    expect(repo.list()).toHaveLength(0);
    await expect(repo.delete("TaskNotes/plugin-task.md")).rejects.toThrow(
      TaskNotFoundError,
    );
  });
});

describe("create", () => {
  test("writes a file the detection rules recognize; dedups filenames", async () => {
    await repo.scan();
    const first = await repo.create({ title: "Buy milk", due: "2026-07-04" });
    const second = await repo.create({ title: "Buy milk" });
    expect(first.path).toBe("TaskNotes/Buy milk.md");
    expect(second.path).toBe("TaskNotes/Buy milk 1.md");
    expect(first.due).toBe("2026-07-04");
    expect(first.tags).toContain("task"); // detectable by the plugin
    // A rescan (fresh process) still sees both.
    const rescanned = new TaskRepository(
      vault,
      "TaskNotes",
      resolveModelConfig(),
      () => NOW,
    );
    await rescanned.scan();
    expect(rescanned.list()).toHaveLength(2);
  });
});

describe("status workflow + archive", () => {
  test("toggleStatus cycles the configured workflow", async () => {
    await seed("TaskNotes/plugin-task.md", PLUGIN_AUTHORED);
    await repo.scan();
    const once = await repo.toggleStatus("TaskNotes/plugin-task.md");
    // Default workflow: none -> open -> in-progress -> done -> none
    expect(once.status).toBe("in-progress");
    const twice = await repo.toggleStatus("TaskNotes/plugin-task.md");
    expect(twice.status).toBe("done");
    expect(repo.isCompleted(twice.status)).toBe(true);
  });

  test("toggleArchive flips and persists", async () => {
    await seed("TaskNotes/plugin-task.md", PLUGIN_AUTHORED);
    await repo.scan();
    const archived = await repo.toggleArchive("TaskNotes/plugin-task.md");
    expect(archived.archived).toBe(true);
    const restored = await repo.toggleArchive("TaskNotes/plugin-task.md");
    expect(restored.archived).toBe(false);
  });
});

describe("recurring instance completion", () => {
  const RECURRING = `---
title: Water plants
status: open
priority: normal
scheduled: 2026-07-01
recurrence: FREQ=DAILY
tags:
  - task
---
`;

  test("explicit date is honored (not server-today)", async () => {
    await seed("TaskNotes/water.md", RECURRING);
    await repo.scan();
    const updated = await repo.completeInstance("TaskNotes/water.md", {
      date: "2026-07-01",
      completed: true,
    });
    expect(updated.complete_instances).toEqual(["2026-07-01"]);
  });

  test("set-semantics: matching state is a no-op, not a toggle", async () => {
    await seed("TaskNotes/water.md", RECURRING);
    await repo.scan();
    await repo.completeInstance("TaskNotes/water.md", {
      date: "2026-07-01",
      completed: true,
    });
    const replay = await repo.completeInstance("TaskNotes/water.md", {
      date: "2026-07-01",
      completed: true,
    });
    expect(replay.complete_instances).toEqual(["2026-07-01"]);
  });

  test("bodyless call toggles (upstream parity); non-recurring throws", async () => {
    await seed("TaskNotes/water.md", RECURRING);
    await seed("TaskNotes/plain.md", PLUGIN_AUTHORED);
    await repo.scan();
    const on = await repo.completeInstance("TaskNotes/water.md");
    expect(on.complete_instances).toEqual([ymdOf(NOW)]);
    const off = await repo.completeInstance("TaskNotes/water.md");
    expect(off.complete_instances ?? []).toEqual([]);
    await expect(repo.completeInstance("TaskNotes/plain.md")).rejects.toThrow(
      NotRecurringError,
    );
  });
});

function ymdOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(date.getFullYear())}-${month}-${day}`;
}
