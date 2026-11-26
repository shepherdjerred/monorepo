import type { DedupeContext, DedupeWorktree, FileProbes } from "./types.ts";

/**
 * Bytes of path arguments per command: a few thousand paths, and far inside
 * the limit on argument length on every platform.
 */
const PATH_BYTES_PER_COMMAND = 120_000;

export function batchPaths(paths: readonly string[]): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let bytes = 0;
  for (const filePath of paths) {
    const size = Buffer.byteLength(filePath) + 1;
    if (batch.length > 0 && bytes + size > PATH_BYTES_PER_COMMAND) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(filePath);
    bytes += size;
  }
  if (batch.length > 0) {
    batches.push(batch);
  }
  return batches;
}

/**
 * Run a command over `paths` in batches, relative to the worktree, and hand
 * each batch's output to `collect`. Returns false when any batch fails: a
 * partial answer would read as "these paths are fine".
 */
export async function overPaths(
  request: {
    readonly wt: DedupeWorktree;
    readonly argv: readonly string[];
    readonly paths: readonly string[];
    readonly ctx: DedupeContext;
  },
  collect: (stdout: string, batch: readonly string[]) => void,
): Promise<boolean> {
  for (const batch of batchPaths(request.paths)) {
    const res = await request.ctx.runner([...request.argv, "--", ...batch], {
      cwd: request.wt.path,
      timeoutMs: 300_000,
    });
    if (res.exitCode !== 0) {
      return false;
    }
    collect(res.stdout, batch);
  }
  return true;
}

/**
 * Paths whose file carries BSD file flags (`st_flags`): immutable, hidden,
 * compressed, dataless and the like. A clone would not keep them, and an
 * immutable file cannot be replaced at all. The system `stat` is named by
 * path because a GNU `stat` earlier on `PATH` reads `-f` differently.
 */
export async function readFlaggedPaths(
  wt: DedupeWorktree,
  paths: readonly string[],
  ctx: DedupeContext,
): Promise<Set<string> | null> {
  const flagged = new Set<string>();
  const ran = await overPaths(
    { wt, argv: ["/usr/bin/stat", "-f", "%f"], paths, ctx },
    (stdout, batch) => {
      // One line per file, in order. A missing line reads as flagged.
      const flags = stdout.split("\n");
      for (const [index, filePath] of batch.entries()) {
        if (flags[index] !== "0") {
          flagged.add(filePath);
        }
      }
    },
  );
  return ran ? flagged : null;
}

/**
 * macOS stamps most files with this attribute to record which app wrote
 * them. It says nothing about the content, and every checkout has it.
 */
const IGNORED_XATTR = "com.apple.provenance";

/**
 * Paths from `xattr` output that carry an attribute other than the ignored
 * one. With several files each line is `<path>: <name>`, in argument order;
 * with a single file it is the bare name. A line that fits no path means the
 * output was not understood, and every remaining path is reported.
 */
export function parseXattrPaths(
  stdout: string,
  batch: readonly string[],
): Set<string> {
  const attributed = new Set<string>();
  let index = 0;
  for (const line of stdout.split("\n")) {
    if (line.length === 0) {
      continue;
    }
    if (batch.length === 1) {
      if (line !== IGNORED_XATTR) {
        attributed.add(batch[0] ?? "");
      }
      continue;
    }
    while (
      index < batch.length &&
      !line.startsWith(`${batch[index] ?? ""}: `)
    ) {
      index += 1;
    }
    const owner = batch[index];
    if (owner === undefined) {
      return new Set(batch);
    }
    if (line.slice(owner.length + 2) !== IGNORED_XATTR) {
      attributed.add(owner);
    }
  }
  return attributed;
}

/**
 * Paths whose file has extended attributes of its own: Finder tags and
 * comments, a quarantine mark, a resource fork. A clone carries the source
 * file's attributes instead, so such a file is neither replaced nor cloned
 * from.
 */
export async function readXattrPaths(
  wt: DedupeWorktree,
  paths: readonly string[],
  ctx: DedupeContext,
): Promise<Set<string> | null> {
  const attributed = new Set<string>();
  const ran = await overPaths(
    { wt, argv: ["/usr/bin/xattr"], paths, ctx },
    (stdout, batch) => {
      for (const filePath of parseXattrPaths(stdout, batch)) {
        attributed.add(filePath);
      }
    },
  );
  return ran ? attributed : null;
}

/** Regular files named in `lsof -F tn` output. */
export function parseOpenFiles(lsofStdout: string): Set<string> {
  const open = new Set<string>();
  let isRegularFile = false;
  for (const line of lsofStdout.split("\n")) {
    if (line.startsWith("f")) {
      isRegularFile = false;
    } else if (line.startsWith("t")) {
      isRegularFile = line === "tREG";
    } else if (isRegularFile && line.startsWith("n")) {
      open.add(line.slice(1));
    }
  }
  return open;
}

/**
 * Every regular file some process of this user has open or mapped right
 * now. A process keeps writing to the file it opened: once that file is
 * renamed away, its writes land in a file nobody can reach by name. Reading
 * is harmless, but telling the two apart is not worth being wrong about.
 * `-n -P` keep `lsof` from resolving hosts and ports, which is all of its
 * usual slowness.
 */
export async function readOpenFiles(
  ctx: DedupeContext,
): Promise<Set<string> | null> {
  const res = await ctx.runner(
    ["/usr/sbin/lsof", "-w", "-n", "-P", "-F", "tn"],
    { timeoutMs: 60_000 },
  );
  return res.exitCode === 0 ? parseOpenFiles(res.stdout) : null;
}

/**
 * What the worktree's files are asked through, so that tests on a system
 * without these tools can stand in for them.
 */
export const SYSTEM_FILE_PROBES: FileProbes = {
  flaggedPaths: readFlaggedPaths,
  xattrPaths: readXattrPaths,
  openFiles: readOpenFiles,
};

/**
 * A boolean git setting as git itself reads it. `--type=bool` makes git
 * normalize every spelling (`0`, `no`, `off`, `false`, and their opposites)
 * and print the value in effect; exit 1 means the setting is not set
 * anywhere. `null` when git cannot say, for instance for a value that is
 * not a boolean at all.
 */
async function readBooleanSetting(
  wt: DedupeWorktree,
  key: string,
  ctx: DedupeContext,
): Promise<boolean | "unset" | null> {
  const res = await ctx.runner(["git", "config", "--type=bool", "--get", key], {
    cwd: wt.path,
    timeoutMs: 10_000,
  });
  if (res.exitCode === 1) {
    return "unset";
  }
  const value = res.stdout.trim();
  return res.exitCode !== 0 || (value !== "true" && value !== "false")
    ? null
    : value === "true";
}

/**
 * Why `git status` cannot vouch for file content in this worktree, if it
 * cannot. Status compares a file's size, times and inode with what the index
 * recorded; these settings make it compare less, and then a file edited at
 * the same size with its mtime put back reads as unchanged. Worktrees can
 * carry their own configuration, so each is asked.
 *
 * Unset means git's default: change times are trusted and stat data is not
 * ignored.
 */
export async function statusTrustProblem(
  wt: DedupeWorktree,
  ctx: DedupeContext,
): Promise<string | null> {
  const trustCtime = await readBooleanSetting(wt, "core.trustctime", ctx);
  const ignoreStat = await readBooleanSetting(wt, "core.ignorestat", ctx);
  // Not a boolean: `default` or `minimal`.
  const checkStat = await ctx.runner(
    ["git", "config", "--get", "core.checkstat"],
    {
      cwd: wt.path,
      timeoutMs: 10_000,
    },
  );
  if (
    trustCtime === null ||
    ignoreStat === null ||
    (checkStat.exitCode !== 0 && checkStat.exitCode !== 1)
  ) {
    return "its git configuration could not be read";
  }
  let problem: string | null = null;
  if (trustCtime === false) {
    problem = "core.trustctime is false";
  } else if (ignoreStat === true) {
    problem = "core.ignoreStat is true";
  } else if (checkStat.stdout.trim().toLowerCase() === "minimal") {
    problem = "core.checkStat is minimal";
  }
  return problem === null
    ? null
    : `${problem}, so git status cannot vouch for its files`;
}
