import { type FileIdentity, isSameFile, lstatRegularFile } from "./clone.ts";
import {
  overPaths,
  readFlaggedPaths,
  readOpenFiles,
  readXattrPaths,
} from "./metadata.ts";
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

/**
 * The index lines a worktree has right now. The whole index is listed again:
 * that takes a fraction of the time git needs to match thousands of paths.
 */
async function readIndexLines(
  wt: DedupeWorktree,
  ctx: DedupeContext,
): Promise<Set<string> | null> {
  const res = await ctx.runner(["git", "ls-files", "-s", "-v", "-z"], {
    cwd: wt.path,
    timeoutMs: 60_000,
  });
  return res.exitCode === 0 ? new Set(res.stdout.split("\0")) : null;
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
 * index entries say nothing about the files.
 */
async function readFilteredPaths(
  wt: DedupeWorktree,
  paths: readonly string[],
  ctx: DedupeContext,
): Promise<Set<string> | null> {
  const filtered = new Set<string>();
  const ran = await overPaths(
    {
      wt,
      argv: ["git", "check-attr", "-z", ...BYTE_CHANGING_ATTRIBUTES],
      paths,
      ctx,
    },
    (stdout) => {
      for (const filePath of parseAttributedPaths(stdout)) {
        filtered.add(filePath);
      }
    },
  );
  return ran ? filtered : null;
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
  const hashes = new Map<string, string>();
  const ran = await overPaths(
    { wt, argv: ["git", "hash-object"], paths, ctx },
    (stdout, batch) => {
      // One line per file, in order. A missing line matches no blob.
      const lines = stdout.split("\n");
      for (const [index, filePath] of batch.entries()) {
        hashes.set(filePath, lines[index] ?? "");
      }
    },
  );
  return ran ? hashes : null;
}

function recordBlobSizes(listing: string, ctx: DedupeContext): void {
  for (const record of listing.split("\0")) {
    const [sha, size] = record.split(" ");
    if (sha !== undefined && size !== undefined && /^\d+$/u.test(size)) {
      ctx.blobSizes.set(sha, Number(size));
    }
  }
}

const BLOB_SIZE_FORMAT = "--format=%(objectname) %(objectsize)";

/** Above this many paths, listing the whole index is the cheaper way. */
const MAX_PATHS_TO_LIST_BY_NAME = 400;

/**
 * Make sure the size of every pending blob is known. Sizes belong to blobs,
 * not worktrees, so they are kept for the whole run, and a worktree is only
 * asked about the blobs no earlier worktree had. Git reads each object's
 * header to answer, which is why the few missing paths are named when they
 * are few.
 */
async function loadBlobSizes(
  wt: DedupeWorktree,
  pending: readonly PendingReplacement[],
  ctx: DedupeContext,
): Promise<boolean> {
  const missing = pending
    .filter((item) => !ctx.blobSizes.has(item.entry.sha))
    .map((item) => item.entry.path);
  if (missing.length === 0) {
    return true;
  }
  if (missing.length <= MAX_PATHS_TO_LIST_BY_NAME) {
    const ran = await overPaths(
      {
        wt,
        argv: [
          "git",
          "--literal-pathspecs",
          "ls-files",
          BLOB_SIZE_FORMAT,
          "-z",
        ],
        paths: missing,
        ctx,
      },
      (stdout) => {
        recordBlobSizes(stdout, ctx);
      },
    );
    return ran && pending.every((item) => ctx.blobSizes.has(item.entry.sha));
  }
  const res = await ctx.runner(["git", "ls-files", BLOB_SIZE_FORMAT, "-z"], {
    cwd: wt.path,
    timeoutMs: 120_000,
  });
  if (res.exitCode !== 0) {
    return false;
  }
  recordBlobSizes(res.stdout, ctx);
  return pending.every((item) => ctx.blobSizes.has(item.entry.sha));
}

/**
 * True when the file on disk is, byte for byte, the blob: it is exactly as
 * long as the blob. Git's line-ending conversion only ever removes carriage
 * returns on the way in, so a file that is clean against its entry and no
 * shorter or longer than the blob had nothing removed and is the blob
 * itself. A file checked out with CRLF endings, or committed with them and
 * normalized, differs in length and is left alone; so two files that are
 * both clean against one blob but hold different line endings can never
 * both pass. This holds whatever `core.autocrlf` and `core.eol` say, in
 * each worktree separately.
 */
function isBlobLength(file: FileIdentity, sha: string, ctx: DedupeContext) {
  return file.size === ctx.blobSizes.get(sha);
}

/** What several git and system commands say about a worktree's paths. */
type PathFacts = {
  readonly lines: Set<string>;
  readonly filtered: Set<string>;
  readonly flagged: Set<string>;
  readonly attributed: Set<string>;
};

async function readPathFacts(
  wt: DedupeWorktree,
  paths: readonly string[],
  ctx: DedupeContext,
): Promise<PathFacts | null> {
  const lines = await readIndexLines(wt, ctx);
  const filtered = await readFilteredPaths(wt, paths, ctx);
  const flagged = await readFlaggedPaths(wt, paths, ctx);
  const attributed = await readXattrPaths(wt, paths, ctx);
  return lines === null ||
    filtered === null ||
    flagged === null ||
    attributed === null
    ? null
    : { lines, filtered, flagged, attributed };
}

/**
 * The files open in some process. An applied run asks afresh for every
 * worktree, immediately before it replaces anything there. A dry run only
 * counts, so one look serves the whole run.
 */
function openFilesNow(ctx: DedupeContext): Promise<Set<string> | null> {
  if (ctx.apply) {
    return readOpenFiles(ctx);
  }
  ctx.dryRunOpenFiles.snapshot ??= readOpenFiles(ctx);
  return ctx.dryRunOpenFiles.snapshot;
}

/**
 * Checks that can only be made once a target worktree's candidates are
 * known, in a handful of commands for all of them:
 *
 * - the index must still list each path as it did when the pass began;
 * - the path must not be filtered, and the file must be as long as its blob;
 * - the file must be nobody's but this pass's to replace: not hard-linked
 *   elsewhere, not another user's, without file flags or extended
 *   attributes of its own, and not open in any process.
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
  const facts = await readPathFacts(wt, paths, ctx);
  const sizesKnown = await loadBlobSizes(wt, pending, ctx);
  const open = await openFilesNow(ctx);
  if (facts === null || !sizesKnown || open === null) {
    result.warnings.push(
      `Skipped ${wt.path}: its index, attributes or open files could not be read`,
    );
    return [];
  }
  const confirmed: PendingReplacement[] = [];
  for (const item of pending) {
    const { path: filePath, sha } = item.entry;
    if (!facts.lines.has(item.line)) {
      continue;
    }
    if (facts.filtered.has(filePath) || !isBlobLength(item.target, sha, ctx)) {
      result.normalizedOrFilteredFiles += 1;
    } else if (
      item.target.nlink !== 1 ||
      item.target.uid !== ctx.currentUid ||
      facts.flagged.has(filePath) ||
      facts.attributed.has(filePath) ||
      open.has(item.targetPath)
    ) {
      result.protectedFiles += 1;
    } else {
      confirmed.push(item);
    }
  }
  return confirmed;
}

function judgeSource(
  item: PendingReplacement,
  before: FileIdentity | null,
  after: FileIdentity | null,
  read: PathFacts & {
    readonly hashes: Map<string, string>;
    readonly ctx: DedupeContext;
  },
): SourceCheck {
  const { path: filePath, sha } = item.entry;
  if (
    read.filtered.has(filePath) ||
    (before !== null && !isBlobLength(before, sha, read.ctx))
  ) {
    return { state: "unproven" };
  }
  // A clone carries the source's flags and attributes with it.
  if (read.flagged.has(filePath) || read.attributed.has(filePath)) {
    return { state: "protected" };
  }
  const isRegisteredBlob =
    before !== null &&
    read.lines.has(item.line) &&
    read.hashes.get(filePath) === sha &&
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
  const facts = await readPathFacts(sourceWt, paths, ctx);
  const hashes = await hashFiles(sourceWt, paths, ctx);
  for (const [index, item] of items.entries()) {
    const seen = before[index] ?? null;
    item.canonical.verified =
      facts === null || hashes === null
        ? { state: "stale" }
        : judgeSource(
            item,
            seen,
            seen === null ? null : await lstatRegularFile(item.sourcePath),
            { ...facts, hashes, ctx },
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
