import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { FleetEnvironment } from "./ports.ts";
import type { PrState } from "./schemas.ts";
import type { FleetStore } from "./state.ts";

// Is `candidate` itself a symlink? Uses `lstat` (no-follow) so it reports the
// link, not its target — and treats a wholly missing path as "not a symlink"
// (the normal write_file-creates-a-new-file case). Any other error propagates.
async function isSymlink(candidate: string): Promise<boolean> {
  try {
    const stats = await lstat(candidate);
    return stats.isSymbolicLink();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function nearestExistingAncestor(candidate: string): Promise<string> {
  try {
    await lstat(candidate);
    return candidate;
  } catch (error) {
    if (!isMissingPath(error)) {
      throw error;
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) {
      throw new Error(`No existing ancestor for path: ${candidate}`, {
        cause: error,
      });
    }
    return nearestExistingAncestor(parent);
  }
}

// Resolve a worktree-relative path to an absolute one, refusing anything that
// escapes the assigned worktree (absolute inputs, `..` segments, or a symlink
// whose real target is outside the tree) or reaches into Git's own metadata.
// Shared by every worker tool that touches the filesystem.
export async function containedPath(
  root: string,
  requestedPath: string,
): Promise<string> {
  const segments = requestedPath.split("/");
  // A `.git` segment is off-limits regardless of where it sits: in a linked
  // worktree `.git` is a file whose contents point at the real Git directory
  // (overwriting it detaches the worktree), and when a primary checkout is
  // reused `.git/config`, `.git/hooks/...`, etc. resolve inside the tree and so
  // would pass the containment check below. A mistaken or prompt-injected worker
  // edit must never corrupt the checkout or mutate remotes/hooks. Case-folded
  // because Git treats `.git` case-insensitively on macOS/Windows.
  if (segments.some((segment) => segment.toLowerCase() === ".git")) {
    throw new Error(`Refusing to edit Git metadata path: ${requestedPath}`);
  }
  if (path.isAbsolute(requestedPath) || segments.includes("..")) {
    throw new Error(`Unsafe worktree path: ${requestedPath}`);
  }
  const canonicalRoot = await realpath(root);
  const absolute = path.resolve(canonicalRoot, requestedPath);
  let targetExists = true;
  try {
    await lstat(absolute);
  } catch (error) {
    if (!isMissingPath(error)) {
      throw error;
    }
    targetExists = false;
  }
  // Reject only a DANGLING symlink at the target (its link resolves to nothing).
  // Such a link can't be canonicalized — `exists()` is false, so the branch
  // below would resolve only the in-tree parent and let the link pass, then
  // `Bun.write` would follow it to an arbitrary, possibly external path. An
  // EXISTING symlink is deliberately allowed through: the canonical containment
  // and `.git` checks below resolve its real target and reject it only if it
  // escapes the tree or reaches Git metadata, so a safe in-tree link (e.g. this
  // repo's `CLAUDE.md` -> `AGENTS.md`) can still be read and edited.
  let canonicalTarget: string;
  try {
    canonicalTarget = await realpath(
      targetExists
        ? absolute
        : await nearestExistingAncestor(path.dirname(absolute)),
    );
  } catch (error) {
    if (targetExists && isMissingPath(error) && (await isSymlink(absolute))) {
      throw new Error(
        `Refusing to write through a dangling symlink: ${requestedPath}`,
        { cause: error },
      );
    }
    throw error;
  }
  const fromRoot = path.relative(canonicalRoot, canonicalTarget);
  if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) {
    throw new Error(`Path escapes assigned worktree: ${requestedPath}`);
  }
  // A symlink whose real target resolves into the checkout's own Git directory
  // (`.git`, `.git/config`, `.git/hooks/...`) stays beneath the root and so
  // passes the escape check above, yet `Bun.write` would follow it and corrupt
  // the checkout or mutate remotes/hooks. The raw-segment guard above cannot see
  // it because the requested segment is the innocuous link name, so check the
  // resolved canonical path too.
  if (
    fromRoot.split(path.sep).some((segment) => segment.toLowerCase() === ".git")
  ) {
    throw new Error(`Refusing to edit Git metadata path: ${requestedPath}`);
  }
  return absolute;
}

// Replace an exact substring in a worktree file. `old_string` must match
// verbatim and be unique unless `replace_all` is set. Literal (non-regex)
// substring semantics throughout: count with split and replace via slice /
// split-join so a `$`-bearing `new_string` is never interpreted as a
// String.replace replacement pattern.
export async function applyStrReplace(
  worktree: string,
  input: {
    path: string;
    old_string: string;
    new_string: string;
    replace_all: boolean;
  },
): Promise<{ path: string; replacements: number }> {
  if (input.old_string === input.new_string) {
    throw new Error(
      "old_string and new_string are identical; nothing to replace",
    );
  }
  const absolute = await containedPath(worktree, input.path);
  const file = Bun.file(absolute);
  if (!(await file.exists())) {
    throw new Error(
      `File does not exist: ${input.path} (use write_file to create it)`,
    );
  }
  const content = await file.text();
  const occurrences = content.split(input.old_string).length - 1;
  if (occurrences === 0) {
    throw new Error(
      `old_string not found in ${input.path}; it must match the file exactly, including whitespace and indentation`,
    );
  }
  if (occurrences > 1 && !input.replace_all) {
    throw new Error(
      `old_string occurs ${String(occurrences)} times in ${input.path}; add surrounding context to make it unique, or pass replace_all to replace every occurrence`,
    );
  }
  const firstIndex = content.indexOf(input.old_string);
  const updated = input.replace_all
    ? content.split(input.old_string).join(input.new_string)
    : content.slice(0, firstIndex) +
      input.new_string +
      content.slice(firstIndex + input.old_string.length);
  await Bun.write(absolute, updated);
  return {
    path: input.path,
    replacements: input.replace_all ? occurrences : 1,
  };
}

// Create or overwrite a worktree file with the given full contents.
export async function writeWorktreeFile(
  worktree: string,
  input: { path: string; content: string },
): Promise<{ path: string; bytes: number }> {
  const absolute = await containedPath(worktree, input.path);
  const bytes = await Bun.write(absolute, input.content);
  return { path: input.path, bytes };
}

// Runs a tool body inside the shared telemetry-recording wrapper, already bound
// to the calling worker's correlation context.
type RecordTool = <T>(
  tool: string,
  input: unknown,
  run: () => Promise<T>,
) => Promise<T>;

type FileEditToolDeps = {
  worktree: string;
  store: FleetStore;
  pr: PrState;
  record: RecordTool;
  environment: FleetEnvironment;
  signal: AbortSignal;
};

function ensureWriteLease(store: FleetStore, pr: PrState): void {
  if (store.operatorRequests.has(pr.identity.number)) {
    throw new Error("PR is waiting for operator input");
  }
  if (
    store.stackWriteOwners.get(pr.stackId) !== pr.identity.number &&
    !store.requestLease(pr, "stack-write")
  ) {
    throw new Error("Stack write lease is not available");
  }
}

// The reliable worker edit surface: exact-match `str_replace` and full-file
// `write_file`. A capable model produces these consistently, where a
// hand-authored unified diff for `apply_patch` frequently fails format or
// whitespace checks and burns the whole cycle.
export function createFileEditTools(deps: FileEditToolDeps) {
  const { worktree, store, pr, record, environment, signal } = deps;
  return {
    str_replace: createTool({
      id: "str_replace",
      description:
        "Replace an exact substring in a file beneath the assigned worktree. `old_string` must match the file verbatim (including whitespace and indentation) and be unique unless `replace_all` is set. This is the preferred way to edit an existing file — reach for it before apply_patch, which needs a correctly formatted unified diff.",
      inputSchema: z.object({
        path: z.string().min(1),
        old_string: z.string().min(1),
        new_string: z.string(),
        replace_all: z.boolean().default(false),
      }),
      outputSchema: z.object({
        path: z.string(),
        replacements: z.number().int(),
      }),
      execute: (input) =>
        record("str_replace", input, async () => {
          ensureWriteLease(store, pr);
          return applyStrReplace(worktree, input);
        }),
    }),
    write_file: createTool({
      id: "write_file",
      description:
        "Create or overwrite a UTF-8 file beneath the assigned worktree with the given full contents. Use for new files or a full rewrite; prefer str_replace for a targeted edit to an existing file.",
      inputSchema: z.object({
        path: z.string().min(1),
        content: z.string(),
      }),
      outputSchema: z.object({ path: z.string(), bytes: z.number().int() }),
      execute: (input) =>
        record("write_file", input, async () => {
          ensureWriteLease(store, pr);
          return writeWorktreeFile(worktree, input);
        }),
    }),
    format_paths: createTool({
      id: "format_paths",
      description:
        "Run Prettier in write mode on explicit files beneath the assigned worktree. Use this when a staged-files formatting hook reports an exact path; directories and broad pathspecs are rejected.",
      inputSchema: z.object({
        paths: z.array(z.string().min(1)).min(1).max(100),
      }),
      outputSchema: z.object({ paths: z.array(z.string()) }),
      execute: (input) =>
        record("format_paths", input, async () => {
          ensureWriteLease(store, pr);
          for (const requestedPath of input.paths) {
            const absolute = await containedPath(worktree, requestedPath);
            const stats = await lstat(absolute);
            if (!stats.isFile()) {
              throw new Error(
                `Formatting path is not a specific file: ${requestedPath}`,
              );
            }
          }
          const result = await environment.runLocalCommand({
            executable: "bunx",
            args: ["prettier", "--write", "--", ...input.paths],
            cwd: worktree,
            timeoutMs: 120_000,
            signal,
          });
          if (result.exitCode !== 0) {
            throw new Error(`Prettier failed: ${result.stderr.trim()}`);
          }
          return { paths: input.paths };
        }),
    }),
  };
}
