import { lstat, readlink } from "node:fs/promises";
import path from "node:path";

import { run } from "./run.ts";

export type GuidanceEntry = Readonly<{
  path: string;
  kind: "file" | "symlink";
  contents: string;
}>;

function trackedSymlinkPath(record: string): string | undefined {
  if (!record.startsWith("120000 ")) return undefined;
  const separator = record.indexOf("\t");
  return separator === -1 ? undefined : record.slice(separator + 1);
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isGuidancePath(
  entryPath: string,
  extraTrackedPaths: ReadonlySet<string>,
): boolean {
  return (
    entryPath.endsWith("AGENTS.md") ||
    entryPath.endsWith("CLAUDE.md") ||
    entryPath.endsWith("SKILL.md") ||
    entryPath === ".claude/skills" ||
    entryPath.includes("/.cursor/rules/") ||
    entryPath.startsWith(".cursor/rules/") ||
    entryPath.includes("/dot_cursor/rules/") ||
    entryPath.startsWith("dot_cursor/rules/") ||
    entryPath.includes("/private_dot_cursor/rules/") ||
    entryPath.startsWith("private_dot_cursor/rules/") ||
    entryPath.startsWith(".claude/skills/") ||
    entryPath.startsWith(".cursor/skills/") ||
    entryPath.startsWith(".opencode/skills/") ||
    extraTrackedPaths.has(entryPath)
  );
}

export async function listGuidanceEntries(
  extraTrackedPaths: ReadonlySet<string>,
  repositoryRoot = path.resolve(import.meta.dir, "../.."),
): Promise<GuidanceEntry[]> {
  const tracked = await run(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repositoryRoot, capture: true, secret: true },
  );
  const trackedModes = await run(
    ["git", "ls-files", "--cached", "--stage", "-z"],
    { cwd: repositoryRoot, capture: true, secret: true },
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
    .filter((entryPath) => isGuidancePath(entryPath, extraTrackedPaths));

  const entries: GuidanceEntry[] = [];
  for (const entryPath of entryPaths) {
    const absolutePath = path.join(repositoryRoot, entryPath);
    let status;
    try {
      status = await lstat(absolutePath);
    } catch (error) {
      if (isMissingPath(error)) continue;
      throw error;
    }
    if (status.isSymbolicLink() || trackedSymlinks.has(entryPath)) {
      entries.push({
        path: entryPath,
        kind: "symlink",
        contents: status.isSymbolicLink()
          ? await readlink(absolutePath)
          : await Bun.file(absolutePath).text(),
      });
    } else {
      entries.push({
        path: entryPath,
        kind: "file",
        contents: await Bun.file(absolutePath).text(),
      });
    }
  }
  return entries;
}
