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

describe("recurring instance completion", () => {
  test("explicit date is honored (not server-today)", async () => {
    await seed("TaskNotes/water.md", RECURRING);
    await repo.scan();
    const updated = await repo.completeInstance("TaskNotes/water.md", {
      date: "2026-07-01",
      completed: true,
    });
    expect(updated.complete_instances).toEqual(["2026-07-01"]);
  });

  test("explicit completion date anchors the next occurrence", async () => {
    const edgeNow = new Date("2026-08-03T12:00:00.000Z");
    await seed(
      "TaskNotes/weekly.md",
      `---
title: Weekly review
status: open
priority: normal
scheduled: 2026-08-01
recurrence: FREQ=WEEKLY
tags:
  - task
---
`,
    );
    const edgeRepo = new TaskRepository(
      vault,
      "TaskNotes",
      resolveModelConfig(),
      () => edgeNow,
    );
    await edgeRepo.scan();

    const updated = await edgeRepo.completeInstance("TaskNotes/weekly.md", {
      date: "2026-08-01",
      completed: true,
    });

    expect(updated.scheduled).toBe("2026-08-08");
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

  test("uncomplete atomically restores the pre-completion recurrence snapshot", async () => {
    const recurrence = "FREQ=WEEKLY";
    const scheduled = "2026-08-01";
    const due = "2026-08-03";
    await seed(
      "TaskNotes/weekly.md",
      `---
title: Weekly review
status: open
priority: normal
scheduled: ${scheduled}
due: ${due}
recurrence: ${recurrence}
tags:
  - task
---
`,
    );
    await repo.scan();

    const completed = await repo.completeInstance("TaskNotes/weekly.md", {
      date: scheduled,
      completed: true,
    });
    expect(completed.complete_instances).toEqual([scheduled]);
    expect(completed.scheduled).toBe("2026-08-08");
    expect(completed.due).toBe("2026-08-10");

    const restored = await repo.completeInstance("TaskNotes/weekly.md", {
      date: scheduled,
      completed: false,
      restore: { scheduled, due, recurrence, skipped: false },
    });
    expect(restored.complete_instances).toEqual([]);
    expect(restored.scheduled).toBe(scheduled);
    expect(restored.due).toBe(due);
    expect(restored.recurrence).toBe(recurrence);
  });

  test("a restore snapshot deletes nullable schedule fields", async () => {
    await seed(
      "TaskNotes/weekly.md",
      `---
title: Weekly review
status: open
recurrence: FREQ=DAILY
tags:
  - task
---
`,
    );
    await repo.scan();
    await repo.completeInstance("TaskNotes/weekly.md", {
      date: "2026-07-01",
      completed: true,
    });

    const restored = await repo.completeInstance("TaskNotes/weekly.md", {
      date: "2026-07-01",
      completed: false,
      restore: {
        scheduled: null,
        due: null,
        recurrence: "FREQ=DAILY",
        skipped: false,
      },
    });
    expect(restored.scheduled).toBeUndefined();
    expect(restored.due).toBeUndefined();
    const raw = await Bun.file(path.join(vault, "TaskNotes/weekly.md")).text();
    expect(raw).not.toContain("scheduled:");
    expect(raw).not.toContain("due:");
  });

  test("restore repairs schedule and skipped membership when completion is already clear", async () => {
    await seed(
      "TaskNotes/weekly.md",
      `---
title: Weekly review
status: open
priority: normal
scheduled: 2026-08-08
due: 2026-08-10
recurrence: DTSTART:20260801;FREQ=WEEKLY
skipped_instances:
  - 2026-07-25
tags:
  - task
---
`,
    );
    await repo.scan();

    const restored = await repo.completeInstance("TaskNotes/weekly.md", {
      date: "2026-08-01",
      completed: false,
      restore: {
        scheduled: "2026-08-01",
        due: "2026-08-03",
        recurrence: "FREQ=WEEKLY",
        skipped: true,
      },
    });
    expect(restored.complete_instances ?? []).toEqual([]);
    expect(restored.scheduled).toBe("2026-08-01");
    expect(restored.due).toBe("2026-08-03");
    expect(restored.recurrence).toBe("FREQ=WEEKLY");
    expect(restored.skipped_instances).toEqual(["2026-07-25", "2026-08-01"]);

    const beforeReplay = await Bun.file(
      path.join(vault, "TaskNotes/weekly.md"),
    ).text();
    const replay = await repo.completeInstance("TaskNotes/weekly.md", {
      date: "2026-08-01",
      completed: false,
      restore: {
        scheduled: "2026-08-01",
        due: "2026-08-03",
        recurrence: "FREQ=WEEKLY",
        skipped: true,
      },
    });
    expect(replay.complete_instances ?? []).toEqual([]);
    expect(replay.skipped_instances).toEqual(["2026-07-25", "2026-08-01"]);
    expect(await Bun.file(path.join(vault, "TaskNotes/weekly.md")).text()).toBe(
      beforeReplay,
    );
  });

  test("bodyless call toggles (upstream parity); non-recurring throws", async () => {
    await seed("TaskNotes/water.md", RECURRING);
    await seed("TaskNotes/plain.md", PLUGIN_AUTHORED);
    await repo.scan();
    const on = await repo.completeInstance("TaskNotes/water.md");
    expect(on.complete_instances).toEqual([ymdOf(NOW)]);
    const off = await repo.completeInstance("TaskNotes/water.md");
    expect(off.complete_instances ?? []).toEqual([]);
    expect(off.scheduled).toBe(on.scheduled);
    await expect(repo.completeInstance("TaskNotes/plain.md")).rejects.toThrow(
      NotRecurringError,
    );
  });

  test("bodyless call targets the server-local day across a UTC boundary", async () => {
    const edgeNow = new Date("2026-07-03T01:00:00.000Z");
    await seed("TaskNotes/water.md", RECURRING);
    const edgeRepo = new TaskRepository(
      vault,
      "TaskNotes",
      resolveModelConfig(),
      () => edgeNow,
    );
    await edgeRepo.scan();

    const updated = await edgeRepo.completeInstance("TaskNotes/water.md");
    expect(updated.complete_instances).toEqual([ymdOf(edgeNow)]);
  });
});

describe("matching-state restore safeguards", () => {
  test("rejects a matching-state restore after an unrelated recurrence edit", async () => {
    await seed(
      "TaskNotes/weekly.md",
      `---
title: Weekly review
status: open
scheduled: 2026-08-08
due: 2026-08-10
recurrence: FREQ=DAILY
tags:
  - task
---
`,
    );
    await repo.scan();

    await expect(
      repo.completeInstance("TaskNotes/weekly.md", {
        date: "2026-08-01",
        completed: false,
        restore: {
          scheduled: "2026-08-01",
          due: "2026-08-03",
          recurrence: "FREQ=WEEKLY",
          skipped: false,
        },
      }),
    ).rejects.toThrow("restore");
  });
});

describe("recurring completion safeguards", () => {
  test("rejects an Undo snapshot after the server schedule changed", async () => {
    await seed(
      "TaskNotes/weekly.md",
      `---
title: Weekly review
status: open
priority: normal
scheduled: 2026-09-01
recurrence: FREQ=WEEKLY
complete_instances:
  - 2026-08-01
tags:
  - task
---
`,
    );
    await repo.scan();

    await expect(
      repo.completeInstance("TaskNotes/weekly.md", {
        date: "2026-08-01",
        completed: false,
        restore: {
          scheduled: "2026-08-01",
          due: null,
          recurrence: "FREQ=WEEKLY",
          skipped: false,
        },
      }),
    ).rejects.toThrow("restore");
    expect(
      repo.list().find((task) => task.path === "TaskNotes/weekly.md")
        ?.scheduled,
    ).toBe("2026-09-01");
  });

  test("rejects an Undo snapshot after a nullable due date was added", async () => {
    await seed(
      "TaskNotes/weekly.md",
      `---
title: Weekly review
status: open
scheduled: 2026-09-01
due: 2026-09-02
recurrence: FREQ=WEEKLY
complete_instances:
  - 2026-08-01
tags:
  - task
---
`,
    );
    await repo.scan();

    await expect(
      repo.completeInstance("TaskNotes/weekly.md", {
        date: "2026-08-01",
        completed: false,
        restore: {
          scheduled: null,
          due: null,
          recurrence: "FREQ=WEEKLY",
          skipped: false,
        },
      }),
    ).rejects.toThrow("restore");
  });

  test("rejects an Undo snapshot after a nullable scheduled date was added", async () => {
    await seed(
      "TaskNotes/weekly.md",
      `---
title: Weekly review
status: open
recurrence: FREQ=WEEKLY
complete_instances:
  - 2026-08-01
tags:
  - task
---
`,
    );
    await repo.scan();

    await repo.update("TaskNotes/weekly.md", { scheduled: "2026-09-01" });

    await expect(
      repo.completeInstance("TaskNotes/weekly.md", {
        date: "2026-08-01",
        completed: false,
        restore: {
          scheduled: null,
          due: null,
          recurrence: "FREQ=WEEKLY",
          skipped: false,
        },
      }),
    ).rejects.toThrow("restore");
  });

  test("bodyless call samples the clock once", async () => {
    let calls = 0;
    await seed("TaskNotes/water.md", RECURRING);
    const edgeRepo = new TaskRepository(
      vault,
      "TaskNotes",
      resolveModelConfig(),
      () => {
        calls += 1;
        return new Date(
          calls === 1 ? "2026-07-03T01:00:00.000Z" : "2026-07-04T01:00:00.000Z",
        );
      },
    );
    await edgeRepo.scan();

    const updated = await edgeRepo.completeInstance("TaskNotes/water.md");
    expect(updated.complete_instances).toEqual(["2026-07-03"]);
    expect(calls).toBe(1);
  });
});

function ymdOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(date.getFullYear())}-${month}-${day}`;
}

describe("time tracking mutations", () => {
  test("start opens a session in frontmatter; double-start is a 400-class error", async () => {
    await seed("TaskNotes/plugin-task.md", PLUGIN_AUTHORED);
    await repo.scan();
    const started = await repo.startTime("TaskNotes/plugin-task.md");
    expect(started.timeEntries).toHaveLength(1);
    expect(started.timeEntries?.[0]?.startTime).toBe(NOW.toISOString());
    expect(started.timeEntries?.[0]?.endTime).toBeUndefined();
    await expect(repo.startTime("TaskNotes/plugin-task.md")).rejects.toThrow(
      "already active",
    );
    // The session is in the FILE (plugin-visible), not a side-store.
    const raw = await Bun.file(
      path.join(vault, "TaskNotes/plugin-task.md"),
    ).text();
    expect(raw).toContain("timeEntries");
  });

  test("stop closes the session; stop without one is a 400-class error", async () => {
    await seed("TaskNotes/plugin-task.md", PLUGIN_AUTHORED);
    await repo.scan();
    await repo.startTime("TaskNotes/plugin-task.md");
    const stopped = await repo.stopTime("TaskNotes/plugin-task.md");
    expect(stopped.timeEntries?.[0]?.endTime).toBe(NOW.toISOString());
    await expect(repo.stopTime("TaskNotes/plugin-task.md")).rejects.toThrow(
      "No active",
    );
  });
});
