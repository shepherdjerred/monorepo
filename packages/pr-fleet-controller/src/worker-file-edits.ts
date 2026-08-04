import { realpath } from "node:fs/promises";
import path from "node:path";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { PrState } from "./schemas.ts";
import type { FleetStore } from "./state.ts";

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
  const targetExists = await Bun.file(absolute).exists();
  const canonicalTarget = await realpath(
    targetExists ? absolute : path.dirname(absolute),
  );
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
};

function holdsWriteLease(store: FleetStore, pr: PrState): void {
  if (store.stackWriteOwners.get(pr.stackId) !== pr.identity.number) {
    throw new Error("Worker does not hold the stack write lease");
  }
}

// The reliable worker edit surface: exact-match `str_replace` and full-file
// `write_file`. A capable model produces these consistently, where a
// hand-authored unified diff for `apply_patch` frequently fails format or
// whitespace checks and burns the whole cycle.
export function createFileEditTools(deps: FileEditToolDeps) {
  const { worktree, store, pr, record } = deps;
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
          holdsWriteLease(store, pr);
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
          holdsWriteLease(store, pr);
          return writeWorktreeFile(worktree, input);
        }),
    }),
  };
}
