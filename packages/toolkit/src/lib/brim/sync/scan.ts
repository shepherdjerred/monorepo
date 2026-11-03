import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { SyncTool } from "./manifest.ts";
import { toArchivePath } from "./paths.ts";

/**
 * Where Claude Code and Codex keep their transcripts on this machine. Mirrors
 * Brim's `LocalLogLocations`: a set `CLAUDE_CONFIG_DIR` / `CODEX_HOME`
 * (comma-separated, `~` expanded) replaces the defaults.
 */
export type SyncRoot = {
  readonly tool: SyncTool;
  /** Directory scanned for `*.jsonl`, or a single file. */
  readonly source: string;
  readonly kind: "directory" | "file";
  /** Archive path prefix for everything under `source`. */
  readonly archivePrefix: string;
};

export type SourceFile = {
  readonly tool: SyncTool;
  readonly relPath: string;
  readonly absolutePath: string;
  readonly size: number;
  readonly mtimeMs: number;
};

type Environment = Readonly<Record<string, string | undefined>>;

function configuredDirs(
  value: string | undefined,
  home: string,
): string[] | null {
  return value === undefined || value.trim().length === 0
    ? null
    : value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .map((entry) =>
          entry === "~" || entry.startsWith("~/")
            ? path.join(home, entry.slice(1))
            : entry,
        );
}

/**
 * With more than one config dir, each one's files are kept apart under its
 * own numbered prefix so identical relative paths cannot collide.
 */
function numbered(prefix: string, index: number, count: number): string {
  return count === 1 ? prefix : `${String(index)}/${prefix}`;
}

export function syncRoots(environment: Environment, home: string): SyncRoot[] {
  const claudeDirs = configuredDirs(environment["CLAUDE_CONFIG_DIR"], home) ?? [
    path.join(home, ".claude"),
  ];
  const codexDirs = configuredDirs(environment["CODEX_HOME"], home) ?? [
    path.join(home, ".codex"),
  ];
  const roots: SyncRoot[] = [];
  for (const [index, dir] of claudeDirs.entries()) {
    roots.push({
      tool: "claude",
      source: path.join(dir, "projects"),
      kind: "directory",
      archivePrefix: numbered("projects", index, claudeDirs.length),
    });
  }
  for (const [index, dir] of codexDirs.entries()) {
    for (const child of ["sessions", "archived_sessions"]) {
      roots.push({
        tool: "codex",
        source: path.join(dir, child),
        kind: "directory",
        archivePrefix: numbered(child, index, codexDirs.length),
      });
    }
    roots.push({
      tool: "codex",
      source: path.join(dir, "history.jsonl"),
      kind: "file",
      archivePrefix: numbered("history.jsonl", index, codexDirs.length),
    });
  }
  return roots;
}

async function jsonlUnder(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, {
      withFileTypes: true,
      recursive: true,
    });
  } catch (error: unknown) {
    if (isMissing(error)) return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .toSorted();
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

async function statFile(
  file: string,
): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const info = await stat(file);
    return info.isFile() ? { size: info.size, mtimeMs: info.mtimeMs } : null;
  } catch (error: unknown) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** Every transcript under `roots`, keyed by archive path. */
export async function scanSourceFiles(
  roots: readonly SyncRoot[],
): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  for (const root of roots) {
    const candidates =
      root.kind === "file" ? [root.source] : await jsonlUnder(root.source);
    for (const absolutePath of candidates) {
      const info = await statFile(absolutePath);
      // A file removed between listing and stat is simply not present.
      if (info === null) continue;
      const relPath =
        root.kind === "file"
          ? root.archivePrefix
          : `${root.archivePrefix}/${toArchivePath(path.relative(root.source, absolutePath))}`;
      files.push({ tool: root.tool, relPath, absolutePath, ...info });
    }
  }
  return files;
}
