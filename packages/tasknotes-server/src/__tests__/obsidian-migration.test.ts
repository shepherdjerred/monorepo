import { describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Priority } from "../../src/protocol/generated.ts";
import {
  buildSyncCommandsFromTasks,
  migrateVaultDirectory,
  parseMarkdownTask,
} from "../../scripts/migrate-obsidian-vault.ts";

describe("Obsidian to Facet Migration", () => {
  test("parses a standard task markdown file correctly", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "task-test-"));
    const filePath = path.join(tmpDir, "Call Costco.md");
    await writeFile(
      filePath,
      `---
title: Call Costco about GLP1
status: done
priority: normal
dateCreated: 2026-08-07T07:21:00.583Z
dateModified: 2026-08-11T22:31:45.635Z
tags:
  - task
completedDate: 2026-08-11
---
They are trying to charge me a large amount.`,
      "utf8",
    );

    const parsed = await parseMarkdownTask(filePath);
    expect(parsed).not.toBeNull();
    expect(parsed?.title).toBe("Call Costco about GLP1");
    expect(parsed?.status).toBe("done");
    expect(parsed?.priority).toBe(Priority.P4);
    expect(parsed?.completedDate).toBe("2026-08-11");
    expect(parsed?.description).toBe(
      "They are trying to charge me a large amount.",
    );
    expect(parsed?.tags).toEqual(["task"]);

    await rm(tmpDir, { recursive: true, force: true });
  });

  test("parses recurring scheduled task correctly", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "task-test-"));
    const filePath = path.join(tmpDir, "Format dashcam every month.md");
    await writeFile(
      filePath,
      `---
title: Format dashcam
status: open
priority: normal
dateCreated: 2026-08-10T23:17:48.413Z
tags:
  - task
scheduled: 2026-10-01
recurrence: DTSTART:20261001;FREQ=MONTHLY;BYMONTHDAY=1
---`,
      "utf8",
    );

    const parsed = await parseMarkdownTask(filePath);
    expect(parsed).not.toBeNull();
    expect(parsed?.title).toBe("Format dashcam");
    expect(parsed?.status).toBe("open");
    expect(parsed?.scheduled).toBe("2026-10-01");
    expect(parsed?.recurrence).toBe(
      "DTSTART:20261001;FREQ=MONTHLY;BYMONTHDAY=1",
    );

    const commands = buildSyncCommandsFromTasks([parsed!]);
    expect(commands.length).toBe(2); // ProjectAdd + TaskAdd (since it is open)
    const taskCmd = commands[1];
    expect(taskCmd).toBeDefined();
    if (taskCmd !== undefined) {
      expect(taskCmd.command.type).toBe("TaskAdd");
      if (taskCmd.command.type === "TaskAdd") {
        expect(taskCmd.command.args.recurrence_rule).toBe(
          "DTSTART:20261001;FREQ=MONTHLY;BYMONTHDAY=1",
        );
        expect(taskCmd.command.args.due_date).toBe("2026-10-01");
      }
    }

    await rm(tmpDir, { recursive: true, force: true });
  });

  test("runs full directory migration", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "task-vault-"));
    await writeFile(
      path.join(tmpDir, "Task 1.md"),
      `---
title: Task 1
status: open
---`,
      "utf8",
    );
    await writeFile(
      path.join(tmpDir, "Task 2.md"),
      `---
title: Task 2
status: done
completedDate: 2026-11-01
---`,
      "utf8",
    );

    const result = await migrateVaultDirectory(tmpDir, { dryRun: true });
    expect(result.total).toBe(2);
    expect(result.open).toBe(1);
    expect(result.done).toBe(1);
    expect(result.commands).toBe(4); // ProjectAdd + TaskAdd(1) + TaskAdd(2) + TaskComplete(2)

    await rm(tmpDir, { recursive: true, force: true });
  });
});
