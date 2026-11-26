import { type FileIdentity, isSameFile, lstatRegularFile } from "./clone.ts";
import type {
  DedupeContext,
  DedupePassResult,
  DedupeWorktree,
  IndexEntry,
  PendingReplacement,
  SourceCheck,
} from "./types.ts";

/**
 * `H <mode> <sha> <stage>\t<path>` from `git ls-files -s -v`. Only a plain
 * cached entry (`H`) for a regular file at stage 0 qualifies: `git status`
 * does not report changes to assume-unchanged or skip-worktree entries, so
 * their content cannot be vouched for.
 */
export function parseIndexLine(line: string): IndexEntry | null {
  const tab = line.indexOf("\t");
  if (tab === -1 || !line.startsWith("H 100") || line[tab - 1] !== "0") {
    return null;
  }
  const mode = line.slice(2, 8);
  return mode === "100644" || mode === "100755"
    ? { sha: line.slice(9, tab - 2), path: line.slice(tab + 1) }
    : null;
}

/** Paths per git invocation, far inside the limit on argument length. */
const PATHS_PER_COMMAND = 500;

/**
 * Run a git command over `paths` in batches and join the output. `null` when
 * any batch fails: a partial answer would read as "these paths are fine".
 */
async function gitOverPaths(
  wt: DedupeWorktree,
  argv: readonly string[],
  paths: readonly string[],
  ctx: DedupeContext,
): Promise<string | null> {
  let output = "";
  for (let start = 0; start < paths.length; start += PATHS_PER_COMMAND) {
    const res = await ctx.runner(
      ["git", ...argv, "--", ...paths.slice(start, start + PATHS_PER_COMMAND)],
      { cwd: wt.path, timeoutMs: 300_000 },
    );
    if (res.exitCode !== 0) {
      return null;
    }
    output += res.stdout;
  }
  return output;
}

/** The index lines a worktree has right now for `paths`. */
async function readIndexLines(
  wt: DedupeWorktree,
  paths: readonly string[],
  ctx: DedupeContext,
): Promise<Set<string> | null> {
  const output = await gitOverPaths(
    wt,
    ["--literal-pathspecs", "ls-files", "-s", "-v", "-z"],
    paths,
    ctx,
  );
  return output === null ? null : new Set(output.split("\0"));
}

const BYTE_CHANGING_ATTRIBUTES = ["filter", "ident", "working-tree-encoding"];

/**
 * Paths from `git check-attr -z` output (`<path> NUL <attribute> NUL <value>
 * NUL`, repeated) that have any of the attributes in effect.
 */
export function parseAttributedPaths(checkAttrStdout: string): Set<string> {
  const attributed = new Set<string>();
  const fields = checkAttrStdout.split("\0");
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const value = fields[index + 2];
    if (value !== "unspecified" && value !== "unset") {
      attributed.add(fields[index] ?? "");
    }
  }
  return attributed;
}

/**
 * Paths whose working file is not a plain function of the blob alone. With a
 * clean/smudge `filter`, `ident` expansion or a `working-tree-encoding`, two
 * worktrees can hold different bytes for one blob and both be clean, so equal
 * index entries say nothing about the files. Line-ending conversion is left
 * in: it is the same in every worktree of a repository.
 */
async function readFilteredPaths(
  wt: DedupeWorktree,
  paths: readonly string[],
  ctx: DedupeContext,
): Promise<Set<string> | null> {
  const output = await gitOverPaths(
    wt,
    ["check-attr", "-z", ...BYTE_CHANGING_ATTRIBUTES],
    paths,
    ctx,
  );
  return output === null ? null : parseAttributedPaths(output);
}

/**
 * The blob each file would be stored as, by path. `git hash-object` applies
 * the path's clean conversion, exactly as `git add` would.
 */
async function hashFiles(
  wt: DedupeWorktree,
  paths: readonly string[],
  ctx: DedupeContext,
): Promise<Map<string, string> | null> {
  const output = await gitOverPaths(wt, ["hash-object"], paths, ctx);
  const hashes = output?.split("\n").filter((line) => line.length > 0);
  return hashes?.length === paths.length
    ? new Map(paths.map((filePath, index) => [filePath, hashes[index] ?? ""]))
    : null;
}

/**
 * Checks that can only be made once a target worktree's candidates are
 * known, in two git calls for all of them: the index must still list each
 * path as it did when the pass began, and the path must not be filtered.
 */
export async function confirmTargets(
  wt: DedupeWorktree,
  pending: readonly PendingReplacement[],
  result: DedupePassResult,
  ctx: DedupeContext,
): Promise<PendingReplacement[]> {
  if (pending.length === 0) {
    return [];
  }
  const paths = pending.map((item) => item.entry.path);
  const lines = await readIndexLines(wt, paths, ctx);
  const filtered = await readFilteredPaths(wt, paths, ctx);
  if (lines === null || filtered === null) {
    result.warnings.push(
      `Skipped ${wt.path}: its index or attributes could not be read again`,
    );
    return [];
  }
  const confirmed: PendingReplacement[] = [];
  for (const item of pending) {
    if (filtered.has(item.entry.path)) {
      result.filteredFiles += 1;
    } else if (lines.has(item.line)) {
      confirmed.push(item);
    }
  }
  return confirmed;
}

function judgeSource(
  item: PendingReplacement,
  before: FileIdentity | null,
  after: FileIdentity | null,
  read: {
    readonly lines: Set<string>;
    readonly filtered: Set<string>;
    readonly hashes: Map<string, string>;
  },
): SourceCheck {
  if (read.filtered.has(item.entry.path)) {
    return { state: "filtered" };
  }
  const isRegisteredBlob =
    before !== null &&
    read.lines.has(item.line) &&
    read.hashes.get(item.entry.path) === item.entry.sha &&
    // Hashed bytes only speak for the file if it did not change meanwhile.
    isSameFile(after, before);
  return isRegisteredBlob ? { state: "ok", file: before } : { state: "stale" };
}

async function verifyWorktreeCopies(
  sourceWt: DedupeWorktree,
  items: readonly PendingReplacement[],
  ctx: DedupeContext,
): Promise<void> {
  const before: (FileIdentity | null)[] = [];
  for (const item of items) {
    before.push(await lstatRegularFile(item.sourcePath));
  }
  const present = items.filter((_item, index) => before[index] !== null);
  const paths = present.map((item) => item.entry.path);
  const lines = await readIndexLines(sourceWt, paths, ctx);
  const filtered = await readFilteredPaths(sourceWt, paths, ctx);
  const hashes = await hashFiles(sourceWt, paths, ctx);
  for (const [index, item] of items.entries()) {
    const seen = before[index] ?? null;
    item.canonical.verified =
      lines === null || filtered === null || hashes === null
        ? { state: "stale" }
        : judgeSource(
            item,
            seen,
            seen === null ? null : await lstatRegularFile(item.sourcePath),
            { lines, filtered, hashes },
          );
  }
}

/**
 * Establish, for every canonical copy about to be cloned from, that it still
 * is the blob it was registered as.
 *
 * A canonical worktree's index is read once, when its pass runs. By the time
 * another worktree wants its file, that worktree may have switched commits:
 * the registry would still name the old blob while the file holds new content
 * of the same size, clean against its new index. So the file itself is hashed
 * and compared with the registered blob, and the index entry is read again.
 * The file's identity is kept with the verdict, and the clone later refuses
 * to proceed if the file is no longer that one.
 */
export async function verifyCanonicalCopies(
  pending: readonly PendingReplacement[],
  ctx: DedupeContext,
): Promise<void> {
  const bySource = new Map<DedupeWorktree, PendingReplacement[]>();
  const queued = new Set<object>();
  for (const item of pending) {
    if (item.canonical.verified !== undefined || queued.has(item.canonical)) {
      continue;
    }
    queued.add(item.canonical);
    const group = bySource.get(item.canonical.worktree) ?? [];
    group.push(item);
    bySource.set(item.canonical.worktree, group);
  }
  for (const [sourceWt, items] of bySource) {
    await verifyWorktreeCopies(sourceWt, items, ctx);
  }
}
