import { mkdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { Task } from "../domain/types.ts";
import { serializeFrontmatter } from "./frontmatter.ts";
import { taskToFrontmatter } from "./task-mapper.ts";

const NodeErrorSchema = z
  .object({
    code: z.string(),
  })
  .passthrough();

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function generateId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function taskFilePath(
  vaultPath: string,
  tasksDir: string,
  task: { id: string; title: string },
): string {
  const slug = slugify(task.title);
  const filename = `${slug}-${task.id}.md`;
  return tasksDir === ""
    ? path.join(vaultPath, filename)
    : path.join(vaultPath, tasksDir, filename);
}

export async function writeTaskFile(
  filePath: string,
  task: Task,
): Promise<void> {
  const { data, content } = taskToFrontmatter(task);
  const raw = serializeFrontmatter(data, content);

  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });

  const tmpPath = `${filePath}.tmp`;
  await Bun.write(tmpPath, raw);
  await rename(tmpPath, filePath);
}

export async function deleteTaskFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error: unknown) {
    const parsed = NodeErrorSchema.safeParse(error);
    if (parsed.success && parsed.data.code === "ENOENT") {
      return;
    }
    throw error;
  }
}
