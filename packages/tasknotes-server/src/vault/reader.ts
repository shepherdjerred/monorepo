import { readdir } from "node:fs/promises";
import path from "node:path";

import type { Task } from "../domain/types.ts";
import { tasksParseFailuresTotal } from "../metrics.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import { frontmatterToTask } from "./task-mapper.ts";

async function walkDir(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const paths: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
      const subPaths = await walkDir(fullPath);
      paths.push(...subPaths);
    } else if (entry.name.endsWith(".md")) {
      paths.push(fullPath);
    }
  }

  return paths;
}

export async function scanVault(
  vaultPath: string,
  tasksDir: string,
): Promise<Map<string, Task>> {
  const tasks = new Map<string, Task>();
  const scanDir = tasksDir === "" ? vaultPath : path.join(vaultPath, tasksDir);

  let files: string[];
  try {
    files = await walkDir(scanDir);
  } catch (error) {
    // A missing/unreadable vault dir means the server would silently report
    // ZERO tasks — make the cause impossible to miss.
    tasksParseFailuresTotal.inc({ reason: "scan_error" });
    console.error(
      `[vault] SCAN FAILED for ${scanDir} — reporting an empty vault: ${String(error)}`,
    );
    return tasks;
  }

  for (const filePath of files) {
    const task = await readTaskFile(filePath, vaultPath);
    if (task !== undefined) {
      tasks.set(task.id, task);
    }
  }

  return tasks;
}

async function readTaskFile(
  filePath: string,
  vaultPath: string,
): Promise<Task | undefined> {
  try {
    const file = Bun.file(filePath);
    const raw = await file.text();
    const { data, content } = parseFrontmatter(raw);
    const relPath = path.relative(vaultPath, filePath);
    return frontmatterToTask(data, content, relPath);
  } catch (error) {
    tasksParseFailuresTotal.inc({ reason: "read_error" });
    console.error(
      `[vault] DROPPED file ${filePath}: read/frontmatter error: ${String(error)}`,
    );
    return undefined;
  }
}
