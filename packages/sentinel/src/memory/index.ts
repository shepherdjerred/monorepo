import { mkdir, readdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { logger } from "@shepherdjerred/sentinel/observability/logger.ts";
import { type Note, parseNote, serializeNote } from "./note.ts";

const log = logger.child({ module: "memory" });

export async function readNote(filePath: string): Promise<Note> {
  const content = await Bun.file(filePath).text();
  const fileStat = await stat(filePath);
  const note = parseNote(filePath, content);
  note.mtime = fileStat.mtime;
  return note;
}

export async function writeNote(filePath: string, note: Note): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });

  const tmpPath = `${filePath}.tmp`;
  const content = serializeNote(note);
  await Bun.write(tmpPath, content);
  await rename(tmpPath, filePath);
  log.debug({ path: filePath }, "wrote note");
}

export async function listNotes(directory: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name.endsWith(".md")) {
        results.push(fullPath);
      }
    }
  }

  await walk(directory);
  return results;
}

export async function ensureMemoryDirs(agentNames: string[]): Promise<void> {
  await mkdir("data/memory/shared", { recursive: true });
  for (const name of agentNames) {
    await mkdir(`data/memory/agents/${name}`, { recursive: true });
  }
  log.info({ agents: agentNames }, "ensured memory directories");
}
