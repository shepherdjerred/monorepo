import { type FileIdentity, isSameFile, lstatRegularFile } from "./clone.ts";
import { overPaths } from "./metadata.ts";
import type { LeftAloneReason } from "./reasons.ts";
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

/**
 * Make sure the size of every pending blob is known. Sizes belong to blobs,
 * not worktrees, so they are kept for the whole run, and git is only asked
 * about blobs no earlier worktree had. `cat-file --batch-check` answers
 * `<name> <type> <size>` per name on its input, in any version of git.
 */
async function loadBlobSizes(
  wt: DedupeWorktree,
  pending: readonly PendingReplacement[],
  ctx: DedupeContext,
): Promise<boolean> {
  const missing = new Set<string>();
  for (const item of pending) {
    if (!ctx.blobSizes.has(item.entry.sha)) {
      missing.add(item.entry.sha);
    }
  }
  if (missing.size === 0) {
    return true;
  }
  const res = await ctx.runner(["git", "cat-file", "--batch-check"], {
    cwd: wt.path,
    stdin: `${[...missing].join("\n")}\n`,
    timeoutMs: 120_000,
  });
  if (res.exitCode !== 0) {
    return false;
  }
  for (const line of res.stdout.split("\n")) {
    const [sha, type, size] = line.split(" ");
    if (sha !== undefined && type === "blob" && /^\d+$/u.test(size ?? "")) {
      ctx.blobSizes.set(sha, Number(size));
    }
  }
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
  const flagged = await ctx.probes.flaggedPaths(wt, paths, ctx);
  const attributed = await ctx.probes.xattrPaths(wt, paths, ctx);
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
    return ctx.probes.openFiles(ctx);
  }
  ctx.dryRunOpenFiles.snapshot ??= ctx.probes.openFiles(ctx);
  return ctx.dryRunOpenFiles.snapshot;
}

/**
 * Why the file is not this pass's to replace, if it is not. Everything an
 * applied run would trip over is looked for here, in a dry run as well: the
 * clone that takes the file's place is made by this user, in the staging
 * directory's group, so a file of another user or group has no equal.
 */
function targetObstacle(
  item: PendingReplacement,
  facts: PathFacts,
  open: ReadonlySet<string>,
  ctx: DedupeContext,
): LeftAloneReason | null {
  const { target } = item;
  if (target.nlink !== 1) {
    return "hardLinked";
  }
  if (target.uid !== ctx.currentUid) {
    return "otherUser";
  }
  if (target.gid !== item.staging.gid) {
    return "otherGroup";
  }
  if (facts.flagged.has(item.entry.path)) {
    return "flagged";
  }
  if (facts.attributed.has(item.entry.path)) {
    return "xattr";
  }
  return open.has(item.targetPath) ? "open" : null;
}

/**
 * Checks that can only be made once a target worktree's candidates are
 * known, in a handful of commands for all of them:
 *
 * - the index must still list each path as it did when the pass began;
 * - the path must not be filtered, and the file must be as long as its blob;
 * - the file must be nobody's but this pass's to replace: not hard-linked
 *   elsewhere, not another user's or in a group a clone would not be in,
 *   without file flags or extended attributes of its own, and not open in
 *   any process.
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
      continue;
    }
    const obstacle = targetObstacle(item, facts, open, ctx);
    if (obstacle === null) {
      confirmed.push(item);
    } else {
      result.leftAlone[obstacle] += 1;
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
