import { lstat, readlink } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

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

export function validateHomeAgentDrift(
  personalAgentContent: string | undefined,
  liveContent: string | undefined,
  homeAgentPath = "~/AGENTS.md",
): { rule: string; path: string; message: string } | undefined {
  if (personalAgentContent === undefined || liveContent === undefined)
    return undefined;
  if (liveContent !== personalAgentContent) {
    return {
      rule: "personal-agent-drift",
      path: "packages/dotfiles/AGENTS.md",
      message: `differs from live ${homeAgentPath}; run 'chezmoi apply' to sync`,
    };
  }
  return undefined;
}

export const PERSONAL_AGENT_PATH = "packages/dotfiles/AGENTS.md";
export const PERSONAL_SKILLS_PATH = "packages/dotfiles/dot_agents/skills";
export const ARCHIVE_PREFIX = "sandbox/archive/";
export const CURSOR_ADAPTER_PATH =
  "packages/dotfiles/private_dot_cursor/rules/agent-guidance.mdc";
export const GEMINI_SOURCE_ADAPTER_PATH =
  "packages/dotfiles/dot_gemini/symlink_GEMINI.md";
export const CURSOR_ADAPTER_CONTENT =
  "---\ndescription: Use the canonical personal and repository agent guidance\nalwaysApply: true\n---\n\n" +
  "Follow `~/AGENTS.md`, then the nearest repository `AGENTS.md`. Load matching\nskills from `.agents/skills`; do not duplicate their instructions here.";
export const REQUIRED_SOURCE_ADAPTERS = new Map([
  ["packages/dotfiles/private_dot_claude/symlink_CLAUDE.md", "../AGENTS.md"],
  ["packages/dotfiles/private_dot_claude/symlink_skills", "../.agents/skills"],
  ["packages/dotfiles/private_dot_codex/symlink_AGENTS.md", "../AGENTS.md"],
  [GEMINI_SOURCE_ADAPTER_PATH, "../AGENTS.md"],
  [
    "packages/dotfiles/dot_gemini/config/symlink_skills",
    "../../.agents/skills",
  ],
]);
export const ROOT_SYMLINKS = new Map([
  ["CLAUDE.md", "AGENTS.md"],
  [".claude/skills", "../.agents/skills"],
]);
export function lineCount(contents: string): number {
  if (contents === "") return 0;
  const count = contents.split(/\r?\n/).length;
  return contents.endsWith("\n") ? count - 1 : count;
}
export function byteCount(contents: string): number {
  return new TextEncoder().encode(contents).byteLength;
}
export function isArchived(entryPath: string): boolean {
  return entryPath.startsWith(ARCHIVE_PREFIX);
}
export function isSkill(entryPath: string): boolean {
  return entryPath.endsWith("/SKILL.md");
}
export function claudeCompatibilityPath(agentPath: string): string {
  return path.posix.join(path.posix.dirname(agentPath), "CLAUDE.md");
}

export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});

export const PORTABLE_SKILL_FIELDS = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]);

export const SKILL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ROOT_AGENT_PATHS = new Set([
  "AGENTS.md",
  "packages/dotfiles/AGENTS.md",
]);
export const AGENT_MAX_LINES = 120;
export const AGENT_MAX_BYTES = 8 * 1024;
export const ROOT_AGENT_MAX_LINES = 200;
export const ROOT_AGENT_MAX_BYTES = 16 * 1024;
export const SKILL_MAX_LINES = 160;
export const SKILL_MAX_BYTES = 12 * 1024;
export const CATALOG_MAX_BYTES = 24 * 1024;
export const gitPath = path.posix;

export const CLIENT_SKILL_DIRECTORIES = new Set(
  [
    ".claude .codex .cursor .opencode .gemini",
    "dot_claude dot_codex dot_cursor dot_opencode",
    "private_dot_claude private_dot_codex private_dot_cursor private_dot_opencode",
  ].flatMap((group) => group.split(" ")),
);

export const GEMINI_SKILL_DIRECTORIES = new Set(
  ".gemini dot_gemini private_dot_gemini".split(" "),
);

export function isGlobalReferenceSkill(entryPath: string): boolean {
  return entryPath.startsWith("packages/dotfiles/dot_agents/skills/");
}

export function skillDirectoryName(entryPath: string): string {
  return gitPath.basename(gitPath.dirname(entryPath));
}

export function catalogRoot(entryPath: string): string | undefined {
  const personalMarker = "packages/dotfiles/dot_agents/skills/";
  if (entryPath.startsWith(personalMarker)) {
    return "packages/dotfiles/dot_agents/skills";
  }
  const marker = "/.agents/skills/";
  if (entryPath.startsWith(".agents/skills/")) return ".agents/skills";
  const index = entryPath.indexOf(marker);
  const end = index + marker.length - 1;
  return index === -1 ? undefined : entryPath.slice(0, end);
}

export function parseSkillFrontmatter(
  entry: GuidanceEntry,
):
  | Readonly<
      z.infer<typeof SkillFrontmatterSchema> & { keys: readonly string[] }
    >
  | undefined {
  if (!entry.contents.startsWith("---\n")) return undefined;
  const closing = entry.contents.indexOf("\n---\n", 4);
  if (closing === -1) return undefined;
  try {
    const parsed = z
      .record(z.string(), z.unknown())
      .parse(parse(entry.contents.slice(4, closing)));
    return {
      ...SkillFrontmatterSchema.parse(parsed),
      keys: Object.keys(parsed),
    };
  } catch {
    return undefined;
  }
}

export function addBudgetViolations(
  entry: GuidanceEntry,
  values: Readonly<{
    lineRule: string;
    byteRule: string;
    maxLines: number;
    maxBytes: number;
  }>,
  violations: { rule: string; path: string; message: string }[],
): void {
  const lines = lineCount(entry.contents);
  const bytes = byteCount(entry.contents);
  if (lines > values.maxLines) {
    violations.push({
      rule: values.lineRule,
      path: entry.path,
      message: `${lines.toString()} lines exceeds ${values.maxLines.toString()}`,
    });
  }
  if (bytes > values.maxBytes) {
    violations.push({
      rule: values.byteRule,
      path: entry.path,
      message: `${bytes.toString()} bytes exceeds ${values.maxBytes.toString()}`,
    });
  }
}

export function hasPathOrDescendant(
  entries: ReadonlyMap<string, GuidanceEntry>,
  entryPath: string,
): boolean {
  return (
    entries.has(entryPath) ||
    [...entries.keys()].some((candidate) =>
      candidate.startsWith(`${entryPath}/`),
    )
  );
}
