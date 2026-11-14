import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { SyncTool } from "./manifest.ts";
import { toArchivePath } from "./paths.ts";
import type { SqliteProjection } from "./snapshot.ts";

/**
 * How a file is archived. `jsonl` is append-only: new complete lines are
 * uploaded as they appear. `json` and `sqlite` are replaced whole: each change
 * starts a new generation. A `sqlite` file is archived as a redacted snapshot
 * of the projected tables (see `snapshot.ts`), never as its live bytes.
 */
export type SourceFormat =
  | { readonly kind: "jsonl" }
  | { readonly kind: "json" }
  | { readonly kind: "sqlite"; readonly projection: SqliteProjection };

/**
 * A file chosen for the archive. Files that share a `group` (one session's
 * log and its state, or a conversation's database and transcript) carry the
 * group's newest mtime, so a pull window keeps or drops them together; a
 * `sidecar` is dropped when its group has no other file.
 */
export type FileSelection = {
  readonly format: SourceFormat;
  readonly group?: string;
  readonly sidecar?: boolean;
};

/**
 * Where an agent keeps its sessions on this machine. Claude Code and Codex
 * mirror Brim's `LocalLogLocations`: a set `CLAUDE_CONFIG_DIR` / `CODEX_HOME`
 * (comma-separated, `~` expanded) replaces the defaults. Grok, Kimi, Muse and
 * Antigravity use the history sources' own roots (`defaultHistoryPaths`), so
 * push archives exactly what `toolkit history` reads.
 */
export type SyncRoot = {
  readonly tool: SyncTool;
  /** A directory, or a single file. */
  readonly source: string;
  readonly kind: "directory" | "file";
  /** Archive path prefix for everything under `source`. */
  readonly archivePrefix: string;
  /**
   * Which files to archive, by `/`-separated path relative to a directory
   * root (`""` for a file root); `null` skips the file.
   */
  readonly select: (relative: string) => FileSelection | null;
};

export type SourceFile = {
  readonly tool: SyncTool;
  readonly relPath: string;
  readonly absolutePath: string;
  readonly format: SourceFormat;
  /** Bytes on disk (for SQLite, the database plus its WAL). */
  readonly size: number;
  /** The newest mtime in the file's group (for SQLite, including its WAL). */
  readonly mtimeMs: number;
};

async function filesUnder(directory: string): Promise<string[]> {
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
    .filter((entry) => entry.isFile())
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

/** A SQLite file's change signal: the database plus its WAL. */
async function statSqlite(
  file: string,
): Promise<{ size: number; mtimeMs: number } | null> {
  const database = await statFile(file);
  if (database === null) return null;
  const wal = await statFile(`${file}-wal`);
  return wal === null
    ? database
    : {
        size: database.size + wal.size,
        mtimeMs: Math.max(database.mtimeMs, wal.mtimeMs),
      };
}

type Candidate = {
  readonly file: Omit<SourceFile, "mtimeMs">;
  readonly mtimeMs: number;
  readonly group: string;
  readonly sidecar: boolean;
};

async function candidatesFor(root: SyncRoot): Promise<Candidate[]> {
  const listed =
    root.kind === "file" ? [root.source] : await filesUnder(root.source);
  const candidates: Candidate[] = [];
  for (const absolutePath of listed) {
    const relative =
      root.kind === "file"
        ? ""
        : toArchivePath(path.relative(root.source, absolutePath));
    const selection = root.select(relative);
    if (selection === null) continue;
    const info =
      selection.format.kind === "sqlite"
        ? await statSqlite(absolutePath)
        : await statFile(absolutePath);
    // A file removed between listing and stat is simply not present.
    if (info === null) continue;
    const relPath =
      root.kind === "file"
        ? root.archivePrefix
        : `${root.archivePrefix}/${relative}`;
    candidates.push({
      file: {
        tool: root.tool,
        relPath,
        absolutePath,
        format: selection.format,
        size: info.size,
      },
      mtimeMs: info.mtimeMs,
      group: `${root.tool}:${selection.group ?? relPath}`,
      sidecar: selection.sidecar ?? false,
    });
  }
  return candidates;
}

/**
 * Every file to archive under `roots`. A group shares its newest mtime, and
 * a sidecar whose group has nothing else is left out.
 */
export async function scanSourceFiles(
  roots: readonly SyncRoot[],
): Promise<SourceFile[]> {
  const candidates: Candidate[] = [];
  for (const root of roots) candidates.push(...(await candidatesFor(root)));
  const newest = new Map<string, number>();
  const primaries = new Set<string>();
  for (const candidate of candidates) {
    newest.set(
      candidate.group,
      Math.max(newest.get(candidate.group) ?? 0, candidate.mtimeMs),
    );
    if (!candidate.sidecar) primaries.add(candidate.group);
  }
  return candidates
    .filter((candidate) => primaries.has(candidate.group))
    .map((candidate) => ({
      ...candidate.file,
      mtimeMs: newest.get(candidate.group) ?? candidate.mtimeMs,
    }));
}
