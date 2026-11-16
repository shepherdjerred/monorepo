#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Priority } from "../src/protocol/generated.ts";
import type { QueuedCommand } from "../src/protocol/generated.ts";
import { InMemoryFacetStore } from "../src/v1/in-memory-store.ts";
import { PrismaFacetStore } from "../src/v1/prisma-store.ts";
import { executeSync } from "../src/v1/sync.ts";
import { getDatabase } from "../src/infrastructure/database.ts";

export type ParsedObsidianTask = {
  filename: string;
  title: string;
  status: "open" | "done";
  priority: Priority;
  dateCreated?: string | undefined;
  dateModified?: string | undefined;
  completedDate?: string | undefined;
  scheduled?: string | undefined;
  recurrence?: string | undefined;
  tags: string[];
  description: string;
};

type MutableTaskFields = {
  title?: string | undefined;
  status?: "open" | "done" | undefined;
  priority?: Priority | undefined;
  dateCreated?: string | undefined;
  dateModified?: string | undefined;
  completedDate?: string | undefined;
  scheduled?: string | undefined;
  recurrence?: string | undefined;
  tags: string[];
};

function parsePriorityValue(rawVal: string): Priority {
  if (rawVal === "urgent") return Priority.P1;
  if (rawVal === "high") return Priority.P2;
  return rawVal === "medium" ? Priority.P3 : Priority.P4;
}

function applyField(
  fields: MutableTaskFields,
  key: string,
  rawVal: string,
): void {
  switch (key) {
    case "title": {
      if (rawVal !== "") fields.title = rawVal;
      break;
    }
    case "status": {
      fields.status = rawVal === "done" ? "done" : "open";
      break;
    }
    case "priority": {
      fields.priority = parsePriorityValue(rawVal);
      break;
    }
    case "dateCreated":
    case "dateModified":
    case "completedDate":
    case "scheduled":
    case "recurrence": {
      if (rawVal !== "") fields[key] = rawVal;
      break;
    }
    default: {
      break;
    }
  }
}

function parseYamlLines(yaml: string): MutableTaskFields {
  const fields: MutableTaskFields = { tags: [] };
  const lines = yaml.split(/\r?\n/);
  let currentKey = "";

  for (const line of lines) {
    if (line.startsWith("  - ") || line.startsWith("- ")) {
      if (currentKey === "tags") {
        fields.tags.push(line.replace(/^[\s-]+/, "").trim());
      }
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    currentKey = line.slice(0, colonIdx).trim();
    const rawVal = line.slice(colonIdx + 1).trim();
    applyField(fields, currentKey, rawVal);
  }

  return fields;
}

export async function parseMarkdownTask(
  filePath: string,
): Promise<ParsedObsidianTask | null> {
  const content = await readFile(filePath, "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);

  const defaultTitle = path.basename(filePath, ".md");
  let description: string;
  const fields: MutableTaskFields = {
    title: defaultTitle,
    status: "open",
    priority: Priority.P4,
    tags: [],
  };

  if (match === null) {
    description = content.trim();
  } else {
    const yaml = match[1];
    description = match[2]?.trim() ?? "";
    if (yaml !== undefined) {
      const parsed = parseYamlLines(yaml);
      Object.assign(fields, parsed);
    }
  }

  const result: ParsedObsidianTask = {
    filename: path.basename(filePath),
    title: fields.title ?? defaultTitle,
    status: fields.status ?? "open",
    priority: fields.priority ?? Priority.P4,
    tags: fields.tags,
    description,
  };

  if (fields.dateCreated !== undefined) result.dateCreated = fields.dateCreated;
  if (fields.dateModified !== undefined)
    result.dateModified = fields.dateModified;
  if (fields.completedDate !== undefined)
    result.completedDate = fields.completedDate;
  if (fields.scheduled !== undefined) result.scheduled = fields.scheduled;
  if (fields.recurrence !== undefined) result.recurrence = fields.recurrence;

  return result;
}

function resolveCompletedAt(t: ParsedObsidianTask): string {
  if (t.completedDate !== undefined) {
    return t.completedDate.includes("T")
      ? t.completedDate
      : `${t.completedDate}T12:00:00.000Z`;
  }
  return t.dateModified ?? new Date().toISOString();
}

export function buildSyncCommandsFromTasks(
  tasks: ParsedObsidianTask[],
  inboxTempId = "project-inbox",
): QueuedCommand[] {
  const commands: QueuedCommand[] = [];

  // 1. Create Inbox project
  commands.push({
    uuid: randomUUID(),
    temp_id: inboxTempId,
    command: {
      type: "ProjectAdd",
      args: {
        name: "Inbox",
      },
    },
  });

  // 2. Add each task
  for (const [i, t] of tasks.entries()) {
    const taskTempId = `task-${String(i + 1)}`;

    const addArgs: {
      title: string;
      project_id: string;
      description?: string;
      priority?: Priority;
      child_order?: number;
      due_date?: string;
      recurrence_rule?: string;
    } = {
      title: t.title,
      project_id: inboxTempId,
      priority: t.priority,
      child_order: i * 10,
    };
    if (t.description.length > 0) addArgs.description = t.description;
    if (t.scheduled !== undefined) addArgs.due_date = t.scheduled;
    if (t.recurrence !== undefined) addArgs.recurrence_rule = t.recurrence;

    commands.push({
      uuid: randomUUID(),
      temp_id: taskTempId,
      command: {
        type: "TaskAdd",
        args: addArgs,
      },
    });

    if (t.status === "done") {
      commands.push({
        uuid: randomUUID(),
        command: {
          type: "TaskComplete",
          args: {
            id: taskTempId,
            completed_at: resolveCompletedAt(t),
          },
        },
      });
    }
  }

  return commands;
}

export type MigrationOptions = {
  dryRun?: boolean | undefined;
  databaseUrl?: string | undefined;
  exportPath?: string | undefined;
};

export async function migrateVaultDirectory(
  sourceDir: string,
  options: MigrationOptions = {},
): Promise<{ total: number; open: number; done: number; commands: number }> {
  const isAccessible = await stat(sourceDir).then(
    () => true,
    () => false,
  );
  if (!isAccessible) {
    throw new Error(`Source vault directory not found at: ${sourceDir}`);
  }

  const rawEntries = await readdir(sourceDir);
  const entries = rawEntries.filter(
    (f) => f.endsWith(".md") && !f.startsWith("."),
  );

  const tasks: ParsedObsidianTask[] = [];
  for (const entry of entries) {
    const parsed = await parseMarkdownTask(path.join(sourceDir, entry));
    if (parsed !== null) tasks.push(parsed);
  }

  const openCount = tasks.filter((t) => t.status === "open").length;
  const doneCount = tasks.filter((t) => t.status === "done").length;

  console.log(
    `[migration] Found ${String(tasks.length)} markdown tasks (${String(openCount)} open, ${String(doneCount)} done).`,
  );

  const commands = buildSyncCommandsFromTasks(tasks);

  if (options.exportPath !== undefined) {
    await writeFile(
      options.exportPath,
      JSON.stringify({ tasks, commands }, null, 2),
      "utf8",
    );
    console.log(
      `[migration] Exported parsed tasks and commands to ${options.exportPath}`,
    );
  }

  const hasDb = Boolean(options.databaseUrl ?? Bun.env["DATABASE_URL"]);
  const shouldExecute = hasDb && options.dryRun !== true;

  const store = shouldExecute
    ? new PrismaFacetStore(getDatabase())
    : new InMemoryFacetStore();

  const userId = "jerred-default-user";
  const result = await executeSync(store, userId, {
    sync_token: "*",
    commands,
  });

  console.log(
    `[migration] Executed ${String(commands.length)} commands into ${shouldExecute ? "PostgreSQL database" : "in-memory store"}.`,
  );
  console.log(
    `[migration] Command status results: ${String(Object.keys(result.sync_status).length)} statuses recorded.`,
  );

  const state = await store.listTasks({ userId, includeDeleted: true });
  console.log(
    `[migration] Verified state: ${String(state.length)} tasks stored (${String(state.filter((t) => !t.completed).length)} open, ${String(state.filter((t) => t.completed).length)} completed).`,
  );

  return {
    total: tasks.length,
    open: openCount,
    done: doneCount,
    commands: commands.length,
  };
}

async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  let dir = "/tmp/obsidian-tasks";
  let dryRun = false;
  let exportPath: string | undefined = path.join(
    import.meta.dir,
    "migrated-tasks.json",
  );

  let i = 0;
  while (i < args.length) {
    const current = args[i];
    if (current === undefined) break;
    switch (current) {
      case "--dir": {
        dir = args[i + 1] ?? dir;
        i += 2;
        break;
      }
      case "--dry-run": {
        dryRun = true;
        i += 1;
        break;
      }
      case "--export": {
        exportPath = args[i + 1];
        i += 2;
        break;
      }
      default: {
        i += 1;
        break;
      }
    }
  }

  const opts: MigrationOptions = { dryRun };
  if (exportPath !== undefined) opts.exportPath = exportPath;

  const stats = await migrateVaultDirectory(dir, opts);
  console.log(`[migration] Complete:`, stats);
}

if (import.meta.main) {
  try {
    await runCli();
    process.exit(0);
  } catch (error: unknown) {
    console.error(`[migration] Error:`, error);
    process.exit(1);
  }
}
