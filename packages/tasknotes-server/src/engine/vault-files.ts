import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/**
 * Filesystem layer for the vault: byte-level reads/writes only, no task
 * semantics (parsing lives in the task repository).
 *
 * Error policy (review finding #12 — the old reader swallowed everything
 * and could install an empty task map with no log):
 * - a missing/unreadable vault ROOT throws — the server must not start or
 *   rescan into "zero tasks" silently;
 * - a single file vanishing between list and read returns null — files
 *   disappearing mid-scan is normal under Obsidian Sync;
 * - writes are atomic (temp file + rename) so a crash never leaves a
 *   half-written task for the plugin to choke on.
 */

const NodeErrorSchema = z.looseObject({ code: z.string() });

function errorCode(error: unknown): string | null {
  const parsed = NodeErrorSchema.safeParse(error);
  return parsed.success ? parsed.data.code : null;
}

/** A vault path segment that hides its subtree from the task engine. */
function isSkippedSegment(name: string): boolean {
  return name.startsWith(".") || name.startsWith("_");
}

/**
 * Does this vault-relative POSIX path denote a task-eligible markdown file?
 *
 * The rule, defined here once: a `.md` file none of whose ANCESTOR
 * directories are dot- or underscore-prefixed (`.obsidian`,
 * `.tasknotes-server`, `_templates`, ...). Only directories gate eligibility
 * — the filename itself is not prefix-filtered, matching how
 * `listMarkdownFiles` walks the tree. The watcher applies this same
 * predicate so live fs events and a full rescan agree on which files count
 * (review finding: the watcher's old first-character check let nested hidden
 * directories like `notes/.obsidian/x.md` slip through).
 */
export function isVaultMarkdownPath(relPath: string): boolean {
  if (!relPath.endsWith(".md")) return false;
  const dirSegments = relPath.split("/").slice(0, -1);
  return !dirSegments.some((seg) => isSkippedSegment(seg));
}

/**
 * Recursively list all .md files under `root`, returning vault-relative
 * paths (POSIX separators — they double as task IDs). Dot- and
 * underscore-prefixed directories are skipped (`.obsidian`,
 * `.tasknotes-server`, `_templates`, ...) per `isVaultMarkdownPath`. Throws
 * if `root` is missing.
 */
export async function listMarkdownFiles(root: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (isSkippedSegment(entry.name)) continue;
        await walk(fullPath);
      } else if (entry.name.endsWith(".md")) {
        results.push(path.relative(root, fullPath).split(path.sep).join("/"));
      }
    }
  }

  await walk(root);
  return results.sort();
}

export type FileSnapshot = {
  readonly text: string;
  readonly mtimeMs: number;
};

/**
 * Read a file plus its mtime (for the repository's staleness checks).
 * Returns null if the file no longer exists; throws on anything else.
 */
export async function readFileSnapshot(
  absPath: string,
): Promise<FileSnapshot | null> {
  try {
    const [text, stats] = await Promise.all([
      Bun.file(absPath).text(),
      stat(absPath),
    ]);
    return { text, mtimeMs: stats.mtimeMs };
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

/** Atomic write: temp file in the same directory, then rename over target. */
export async function writeFileAtomic(
  absPath: string,
  text: string,
): Promise<void> {
  await mkdir(path.dirname(absPath), { recursive: true });
  const tmpPath = `${absPath}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  await Bun.write(tmpPath, text);
  await rename(tmpPath, absPath);
}

/** Delete a file; an already-gone file is success (the goal state holds). */
export async function deleteFile(absPath: string): Promise<void> {
  try {
    await unlink(absPath);
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
}
