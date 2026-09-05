import { lstat, readlink } from "node:fs/promises";
import path from "node:path";

import { run } from "./run.ts";

export type GuidanceEntry = Readonly<{
  path: string;
  kind: "file" | "symlink";
  contents: string;
}>;

export type GuidanceReadMode = "worktree" | "index";

function trackedSymlinkPath(record: string): string | undefined {
  if (!record.startsWith("120000 ")) return undefined;
  const separator = record.indexOf("\t");
  return separator === -1 ? undefined : record.slice(separator + 1);
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function hasPathPrefix(entryPath: string, prefix: string): boolean {
  return (
    entryPath === prefix ||
    entryPath.startsWith(`${prefix}/`) ||
    entryPath.includes(`/${prefix}/`)
  );
}

function isGuidancePath(
  entryPath: string,
  extraTrackedPaths: ReadonlySet<string>,
): boolean {
  const cursorRule = [
    ".cursor/rules",
    "dot_cursor/rules",
    "private_dot_cursor/rules",
  ].some((prefix) => hasPathPrefix(entryPath, prefix));
  return (
    entryPath.endsWith("AGENTS.md") ||
    entryPath.endsWith("CLAUDE.md") ||
    entryPath.endsWith("GEMINI.md") ||
    entryPath.endsWith("SKILL.md") ||
    entryPath === ".claude/skills" ||
    cursorRule ||
    entryPath.startsWith(".claude/skills/") ||
    entryPath.startsWith(".cursor/skills/") ||
    entryPath.startsWith(".opencode/skills/") ||
    extraTrackedPaths.has(entryPath)
  );
}

async function readTrackedEntry(
  entryPath: string,
  trackedPaths: ReadonlySet<string>,
  trackedSymlinks: ReadonlySet<string>,
  repositoryRoot: string,
): Promise<GuidanceEntry | undefined> {
  if (!trackedPaths.has(entryPath)) return undefined;
  const staged = await run(["git", "show", `:${entryPath}`], {
    cwd: repositoryRoot,
    capture: true,
    secret: true,
  });
  return {
    path: entryPath,
    kind: trackedSymlinks.has(entryPath) ? "symlink" : "file",
    contents: staged.stdout,
  };
}

async function readWorktreeEntry(
  entryPath: string,
  trackedSymlinks: ReadonlySet<string>,
  repositoryRoot: string,
): Promise<GuidanceEntry | undefined> {
  const absolutePath = path.join(repositoryRoot, entryPath);
  let status;
  try {
    status = await lstat(absolutePath);
  } catch (error) {
    if (isMissingPath(error)) return undefined;
    throw error;
  }
  if (status.isSymbolicLink() || trackedSymlinks.has(entryPath)) {
    return {
      path: entryPath,
      kind: "symlink",
      contents: status.isSymbolicLink()
        ? await readlink(absolutePath)
        : await Bun.file(absolutePath).text(),
    };
  }
  return {
    path: entryPath,
    kind: "file",
    contents: await Bun.file(absolutePath).text(),
  };
}

export async function listGuidanceEntries(
  extraTrackedPaths: ReadonlySet<string>,
  repositoryRoot = path.resolve(import.meta.dir, "../.."),
  readMode: GuidanceReadMode = "worktree",
): Promise<GuidanceEntry[]> {
  const tracked = await run(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repositoryRoot, capture: true, secret: true },
  );
  const trackedModes = await run(
    ["git", "ls-files", "--cached", "--stage", "-z"],
    { cwd: repositoryRoot, capture: true, secret: true },
  );
  const trackedPaths = new Set(
    trackedModes.stdout
      .split("\0")
      .map((record) => record.slice(record.indexOf("\t") + 1))
      .filter((entryPath) => entryPath !== ""),
  );
  const trackedSymlinks = new Set(
    trackedModes.stdout
      .split("\0")
      .map((record) => trackedSymlinkPath(record))
      .filter((entryPath) => entryPath !== undefined),
  );
  const entryPaths = tracked.stdout
    .split("\0")
    .filter((entryPath) => entryPath !== "")
    .filter((entryPath) => isGuidancePath(entryPath, extraTrackedPaths))
    .filter(
      (entryPath) => readMode === "worktree" || trackedPaths.has(entryPath),
    );

  const entries = await Promise.all(
    entryPaths.map(async (entryPath) => {
      const trackedEntry =
        readMode === "index"
          ? await readTrackedEntry(
              entryPath,
              trackedPaths,
              trackedSymlinks,
              repositoryRoot,
            )
          : undefined;
      return (
        trackedEntry ??
        (await readWorktreeEntry(entryPath, trackedSymlinks, repositoryRoot))
      );
    }),
  );
  return entries.flatMap((entry) => (entry === undefined ? [] : [entry]));
}
