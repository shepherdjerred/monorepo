// Persistent memory for goal mode, scoped to ONE save (one Discord guild). The
// driver points the directory at saves/<guildId>/goal-memory, so it persists on
// the same PVC as the flash save. Layout:
//
//   MEMORY.md            — curated long-term memory, injected into EVERY prompt.
//                          The only bot-writable file (WRITE goes here).
//   logs/<name>.md       — one record per past goal session, system-written from
//                          the bot's final report. Read-only to the bot.
//   archived-memory/<ts>.md — the previous MEMORY.md, snapshotted on each write,
//                          so a curated rewrite never loses prior content.
//
// The bot drives this as a tiny scoped filesystem: list() / read() / grep() over
// the whole tree, and writeMemory() (MEMORY.md only). All caller-supplied paths
// are resolved INSIDE the root (resolveScoped) — no traversal, no absolute paths.

import path from "node:path";
import { readdir, rm, stat } from "node:fs/promises";
import type { GoalState } from "./goal-types.ts";

type StatResult = Awaited<ReturnType<typeof stat>>;

const MEMORY_FILE = "MEMORY.md";
const LOGS_DIR = "logs";
const ARCHIVE_DIR = "archived-memory";

// MEMORY.md is injected verbatim into the prompt, so cap it (~16k chars ≈ ~4k
// tokens). Session logs aren't injected but are capped (truncated) too.
const MEMORY_MAX_CHARS = 16_000;
const LOG_MAX_CHARS = 16_000;

// Retention: bound PVC growth. Logs are the durable record; archives are
// MEMORY.md history.
const LOGS_KEEP = 200;
const ARCHIVE_KEEP = 50;

// grep bounds so a search stays cheap regardless of history size.
const GREP_MAX_HITS = 50;
const GREP_MAX_FILES = 200;
const LINE_MAX_CHARS = 200;

// Session-log ids are derived from the goal (timestamp + goal-id); validate the
// filename stem is a single safe path segment before writing.
const SAFE_ID = /^[a-z0-9][\w.-]*$/i;

export type FsEntry = {
  name: string;
  kind: "file" | "dir";
  // Path relative to the memory root, forward-slashed (e.g. "MEMORY.md", "logs",
  // "logs/2026-...-climb.md").
  path: string;
};

export type GrepMatch = {
  path: string;
  line: number;
  text: string;
};

export type SessionLogMeta = {
  // Filename stem (sortable + stable per goal). Built from startedAt + goalId.
  id: string;
  goalId: string;
  goal: string;
  startedAt: string;
  status?: string;
  finishedAt?: string;
  exitCode?: number;
};

/**
 * Derive a session log's metadata from a (terminal) goal state. The id is the
 * start time (filesystem-safe — colons/dots become dashes, trailing Z dropped)
 * plus a short goal-id suffix, so it sorts chronologically and is stable per
 * goal (a re-write refines one file rather than duplicating).
 */
export function buildSessionLogMeta(state: GoalState): SessionLogMeta {
  const stamp = state.startedAt.replaceAll(/[:.]/g, "-").replace("Z", "");
  return {
    id: `${stamp}-${state.id.slice(0, 8)}`,
    goalId: state.id,
    goal: state.goal,
    startedAt: state.startedAt,
    status: state.status,
    ...(state.finishedAt !== undefined && { finishedAt: state.finishedAt }),
    ...(state.exitCode !== undefined && { exitCode: state.exitCode }),
  };
}

export type MemoryWriteResult = {
  // Path relative to the memory root (e.g. "MEMORY.md").
  path: string;
  chars: number;
  // The archive snapshot of the prior MEMORY.md (relative to the memory root), if one was made.
  archivedPath?: string;
};

export type SessionLogWriteResult = {
  // Path relative to the memory root (e.g. "logs/2026-…-goal.md").
  path: string;
  id: string;
};

export class GoalMemory {
  constructor(
    private readonly directory: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private memoryPath(): string {
    return path.join(this.directory, MEMORY_FILE);
  }

  /** Resolve a bot-supplied relative path INSIDE the memory root, or throw. */
  private resolveScoped(relPath: string): string {
    const normalized = relPath.replace(/^\/+/, "");
    const root = path.resolve(this.directory);
    const target = path.resolve(root, normalized);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`path escapes the memory root: ${relPath}`);
    }
    return target;
  }

  private toRel(absolute: string): string {
    return path.relative(this.directory, absolute).split(path.sep).join("/");
  }

  /** True iff relPath resolves to MEMORY.md (used for the read-before-write gate). */
  isMemoryPath(relPath: string): boolean {
    try {
      return this.resolveScoped(relPath) === this.memoryPath();
    } catch {
      return false;
    }
  }

  /** Curated MEMORY.md content, or "" when nothing has been written yet. */
  async readMemory(): Promise<string> {
    const file = Bun.file(this.memoryPath());
    if (!(await file.exists())) return "";
    const text = await file.text();
    return text.trim();
  }

  /**
   * Replace MEMORY.md with a curated version. Snapshots the prior content into
   * archived-memory/ first (unless absent/empty/unchanged) so nothing is lost.
   * Rejects empty content (can't blank-wipe) and over-long content (prompt budget).
   */
  async writeMemory(content: string): Promise<MemoryWriteResult> {
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      throw new Error("memory content cannot be empty");
    }
    if (trimmed.length > MEMORY_MAX_CHARS) {
      throw new Error(
        `memory content too long (${String(trimmed.length)} chars; keep it under ${String(MEMORY_MAX_CHARS)})`,
      );
    }
    const current = await this.readMemory();
    let archivedPath: string | undefined;
    if (current.length > 0 && current !== trimmed) {
      archivedPath = await this.archiveMemory(current);
    }
    const target = this.memoryPath();
    await Bun.write(target, `${trimmed}\n`, { createPath: true });
    return {
      path: this.toRel(target),
      chars: trimmed.length,
      ...(archivedPath !== undefined && { archivedPath }),
    };
  }

  private async archiveMemory(current: string): Promise<string> {
    const stamp = this.now()
      .toISOString()
      .replaceAll(/[:.]/g, "-")
      .replace("Z", "");
    const archivePath = path.join(this.directory, ARCHIVE_DIR, `${stamp}.md`);
    await Bun.write(archivePath, `${current}\n`, { createPath: true });
    await this.prune(path.join(this.directory, ARCHIVE_DIR), ARCHIVE_KEEP);
    return this.toRel(archivePath);
  }

  /**
   * System-written per-session log (the bot's final report). Filename is the
   * stable id plus a readable goal slug. Truncates over-long bodies rather than
   * throwing — this runs at session teardown and must not fail the session.
   */
  async writeSessionLog(
    meta: SessionLogMeta,
    content: string,
  ): Promise<SessionLogWriteResult> {
    assertSafeId(meta.id);
    const trimmed = content.trim();
    const body =
      trimmed.length > LOG_MAX_CHARS
        ? trimmed.slice(0, LOG_MAX_CHARS)
        : trimmed;
    const id = `${meta.id}-${slug(meta.goal)}`;
    const target = path.join(this.directory, LOGS_DIR, `${id}.md`);
    await Bun.write(
      target,
      renderSessionLog(meta, body, this.now().toISOString()),
      { createPath: true },
    );
    await this.prune(path.join(this.directory, LOGS_DIR), LOGS_KEEP);
    return { path: this.toRel(target), id };
  }

  /** List a directory (default = root). A file path lists just that file. */
  async list(relPath = ""): Promise<FsEntry[]> {
    const target = this.resolveScoped(relPath);
    const info = await safeStat(target);
    if (info === undefined) return [];
    if (info.isFile()) {
      return [
        { name: path.basename(target), kind: "file", path: this.toRel(target) },
      ];
    }
    const dirents = await readdir(target, { withFileTypes: true });
    const entries: FsEntry[] = dirents.map((dirent) => ({
      name: dirent.name,
      kind: dirent.isDirectory() ? "dir" : "file",
      path: this.toRel(path.join(target, dirent.name)),
    }));
    // Directories first, then files; within each, newest-first by name (the
    // timestamp-prefixed names sort reverse-chronologically).
    return entries.toSorted(compareEntries);
  }

  /** Full text of a scoped file. Throws if missing or a directory. */
  async read(relPath: string): Promise<string> {
    const target = this.resolveScoped(relPath);
    const info = await safeStat(target);
    if (info?.isFile() !== true) {
      throw new Error(`not found: ${relPath}`);
    }
    const text = await Bun.file(target).text();
    return text.trim();
  }

  /** Case-insensitive line search across all *.md under the scoped path. */
  async grep(query: string, relPath = ""): Promise<GrepMatch[]> {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return [];
    const root = this.resolveScoped(relPath);
    const files = await this.markdownFiles(root);
    const matches: GrepMatch[] = [];
    for (const file of files) {
      if (matches.length >= GREP_MAX_HITS) break;
      const text = await Bun.file(file).text();
      const lines = text.split("\n");
      for (const [index, line] of lines.entries()) {
        if (matches.length >= GREP_MAX_HITS) break;
        if (line.toLowerCase().includes(needle)) {
          matches.push({
            path: this.toRel(file),
            line: index + 1,
            text: clip(line),
          });
        }
      }
    }
    return matches;
  }

  /**
   * Absolute paths of every *.md under `target` (a file or dir), MEMORY.md
   * first, then newest-first, capped at GREP_MAX_FILES.
   */
  private async markdownFiles(target: string): Promise<string[]> {
    const collected = await this.collectMarkdown(target);
    return collected
      .toSorted((a, b) => {
        const relA = this.toRel(a);
        const relB = this.toRel(b);
        const weightA = relA === MEMORY_FILE ? 0 : 1;
        const weightB = relB === MEMORY_FILE ? 0 : 1;
        if (weightA !== weightB) return weightA - weightB;
        return relB.localeCompare(relA);
      })
      .slice(0, GREP_MAX_FILES);
  }

  private async collectMarkdown(target: string): Promise<string[]> {
    const info = await safeStat(target);
    if (info === undefined) return [];
    if (info.isFile()) {
      return target.endsWith(".md") ? [target] : [];
    }
    const out: string[] = [];
    const dirents = await readdir(target, { withFileTypes: true });
    for (const dirent of dirents) {
      const child = path.join(target, dirent.name);
      if (dirent.isDirectory()) {
        out.push(...(await this.collectMarkdown(child)));
      } else if (dirent.name.endsWith(".md")) {
        out.push(child);
      }
    }
    return out;
  }

  /** Keep the newest `keep` *.md files in `dir`, delete the rest. No-op if absent. */
  private async prune(dir: string, keep: number): Promise<void> {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    const stale = names
      .filter((name) => name.endsWith(".md"))
      .toSorted((a, b) => b.localeCompare(a))
      .slice(keep);
    for (const name of stale) {
      await rm(path.join(dir, name), { force: true });
    }
  }
}

async function safeStat(target: string): Promise<StatResult | undefined> {
  try {
    return await stat(target);
  } catch {
    return undefined;
  }
}

function compareEntries(a: FsEntry, b: FsEntry): number {
  if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
  return b.name.localeCompare(a.name);
}

function assertSafeId(id: string): void {
  if (!SAFE_ID.test(id) || id.includes("..") || path.basename(id) !== id) {
    throw new Error(`invalid session log id: ${id}`);
  }
}

function slug(goal: string): string {
  const value = goal
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return value.length > 0 ? value : "goal";
}

function clip(line: string): string {
  const flattened = line.replaceAll(/\s+/g, " ").trim();
  return flattened.length <= LINE_MAX_CHARS
    ? flattened
    : `${flattened.slice(0, LINE_MAX_CHARS)}…`;
}

function renderSessionLog(
  meta: SessionLogMeta,
  content: string,
  written: string,
): string {
  // JSON.stringify each value → a safe double-quoted YAML scalar even when the
  // goal text contains colons, quotes, or newlines.
  const lines = [
    "---",
    `id: ${JSON.stringify(meta.id)}`,
    `goalId: ${JSON.stringify(meta.goalId)}`,
    `goal: ${JSON.stringify(meta.goal)}`,
    `startedAt: ${JSON.stringify(meta.startedAt)}`,
  ];
  if (meta.status !== undefined)
    lines.push(`status: ${JSON.stringify(meta.status)}`);
  if (meta.finishedAt !== undefined) {
    lines.push(`finishedAt: ${JSON.stringify(meta.finishedAt)}`);
  }
  if (meta.exitCode !== undefined)
    lines.push(`exitCode: ${String(meta.exitCode)}`);
  lines.push(`written: ${JSON.stringify(written)}`, "---", "");
  return `${lines.join("\n")}${content}\n`;
}
