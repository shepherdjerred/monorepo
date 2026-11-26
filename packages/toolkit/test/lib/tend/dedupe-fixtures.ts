import { createHash, randomBytes } from "node:crypto";
import {
  appendFile,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sweepDedupe, type SweepDedupeOptions } from "#lib/tend/dedupe.ts";
import type { FileProbes } from "#lib/tend/dedupe/types.ts";
import { resolveTendPaths } from "#lib/tend/paths.ts";
import type { CommandRunner, SurfaceSweepResult } from "#lib/tend/types.ts";
import { computeWorktreeLastActivityMs } from "#lib/tend/worktrees-git.ts";
import { gitThrough, realGitRunner } from "./real-git.ts";
import { makeLiveness } from "./worktree-fixtures.ts";

export const onApfs = process.platform === "darwin";

/**
 * Probes for a test that plays macOS on any system: no file has flags or
 * extended attributes and none is open. The real ones need macOS's own
 * `stat`, `xattr` and `lsof`.
 */
export const PLAIN_FILE_PROBES: FileProbes = {
  flaggedPaths: () => Promise.resolve(new Set<string>()),
  xattrPaths: () => Promise.resolve(new Set<string>()),
  openFiles: () => Promise.resolve(new Set<string>()),
};
export const runner = realGitRunner();
export const git = gitThrough(runner);

/**
 * Physical device offset of each file's first byte (`F_LOG2PHYS_EXT`). Two
 * files that report the same offset store their data in the same blocks.
 */
const PHYSICAL_OFFSET_SCRIPT = `
import fcntl, os, struct, sys
for name in sys.argv[1:]:
    fd = os.open(name, os.O_RDONLY)
    try:
        os.fsync(fd)
        request = struct.pack("=Iqq", 0, os.fstat(fd).st_size, 0)
        print(struct.unpack("=Iqq", fcntl.fcntl(fd, 65, request))[2])
    finally:
        os.close(fd)
`;

export async function physicalOffsets(
  files: readonly string[],
): Promise<string[]> {
  const res = await runner(
    ["python3", "-I", "-c", PHYSICAL_OFFSET_SCRIPT, ...files],
    {},
  );
  if (res.exitCode !== 0) {
    throw new Error(`physical offset probe failed: ${res.stderr}`);
  }
  return res.stdout.trim().split("\n");
}

const tempDirs: string[] = [];

/** Remove every fixture built so far; call from `afterEach`. */
export async function removeFixtures(): Promise<void> {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

export type Fixture = {
  readonly root: string;
  readonly gitRoot: string;
  readonly main: string;
  readonly a: string;
  readonly b: string;
  readonly tendDir: string;
  /** Every command the sweep ran, with the directory it ran in. */
  readonly commands: { argv: readonly string[]; cwd: string }[];
  readonly runner: CommandRunner;
  readonly sweep: (
    overrides?: Partial<SweepDedupeOptions>,
  ) => Promise<SurfaceSweepResult>;
};

/**
 * `<root>/git/proj` with worktrees `a` and `b` on the same commit. Worktree
 * `a` then gets one file rewritten at the same size, one grown, and one
 * untracked file; `b` stays clean.
 */
export async function buildFixture(
  beforeFirstCommit?: (main: string) => Promise<void>,
): Promise<Fixture> {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "tend-dedupe-test-")),
  );
  tempDirs.push(root);
  const gitRoot = path.join(root, "git");
  const main = path.join(gitRoot, "proj");
  const a = path.join(root, "wts", "a");
  const b = path.join(root, "wts", "b");
  await mkdir(path.join(main, "sub", "dir"), { recursive: true });
  await git(main, "init", "-q", "-b", "main");
  await Bun.write(path.join(main, "big.bin"), randomBytes(200_000));
  await Bun.write(path.join(main, "tool.sh"), randomBytes(100_000));
  await chmod(path.join(main, "tool.sh"), 0o755);
  await Bun.write(path.join(main, "sub/dir/nested.bin"), randomBytes(150_000));
  await Bun.write(path.join(main, "modified.bin"), randomBytes(120_000));
  await Bun.write(path.join(main, "grown.bin"), randomBytes(90_000));
  await Bun.write(path.join(main, "small.txt"), randomBytes(1500));
  await beforeFirstCommit?.(main);
  await git(main, "add", "-A");
  await git(main, "commit", "-q", "-m", "initial");
  await git(main, "worktree", "add", "-q", "-b", "feat/a", a);
  await git(main, "worktree", "add", "-q", "-b", "feat/b", b);
  await Bun.write(path.join(a, "modified.bin"), randomBytes(120_000));
  await appendFile(path.join(a, "grown.bin"), "more");
  await Bun.write(path.join(a, "untracked.bin"), randomBytes(200_000));
  await Bun.write(path.join(b, "untracked.bin"), randomBytes(200_000));

  const tendDir = path.join(root, "tend");
  const commands: Fixture["commands"] = [];
  const recordingRunner: CommandRunner = (argv, options = {}) => {
    commands.push({ argv: [...argv], cwd: options.cwd ?? "" });
    return runner(argv, options);
  };
  return {
    root,
    gitRoot,
    main,
    a,
    b,
    tendDir,
    commands,
    runner: recordingRunner,
    sweep: (overrides = {}) =>
      sweepDedupe({
        liveness: makeLiveness({ platform: process.platform }),
        runner: recordingRunner,
        apply: true,
        paths: resolveTendPaths({ tendDir }),
        gitDirs: [gitRoot],
        homeDir: root,
        ...overrides,
      }),
  };
}

/** The reaper's newest activity signal for a worktree. */
export async function reaperActivityMs(wt: string): Promise<number> {
  const signals = await computeWorktreeLastActivityMs({
    wtPath: wt,
    gitDir: await git(wt, "rev-parse", "--absolute-git-dir"),
    runner,
    changedPaths: ["untracked.bin", "sub/dir/nested.bin"],
  });
  return signals.lastActivityMs;
}

/** Where a worktree's clones are staged before being renamed into place. */
export async function stagingDir(worktree: string): Promise<string> {
  const gitDir = await git(worktree, "rev-parse", "--absolute-git-dir");
  return path.join(gitDir, "tend-dedupe");
}

/**
 * A file's content as a short digest. Comparing digests keeps a failed
 * assertion from diffing hundreds of kilobytes.
 */
export async function digest(file: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await Bun.file(file).bytes());
  return hash.digest("hex");
}

export async function startOf(file: string): Promise<string> {
  const text = await Bun.file(file).text();
  return text.slice(0, 3);
}

export async function inodes(dir: string, names: readonly string[]) {
  const result: Record<string, number> = {};
  for (const name of names) {
    const info = await lstat(path.join(dir, name));
    result[name] = info.ino;
  }
  return result;
}

export const SHARED = ["big.bin", "tool.sh", "sub/dir/nested.bin"] as const;
export const UNTOUCHED_IN_A = [
  "modified.bin",
  "grown.bin",
  "small.txt",
  "untracked.bin",
] as const;

/** What a replacement may and may not change about a worktree's files. */
export async function sharedFileFacts(wt: string) {
  return {
    big: await lstat(path.join(wt, "big.bin")),
    tool: await lstat(path.join(wt, "tool.sh")),
    nestedDir: await lstat(path.join(wt, "sub", "dir")),
    rootDir: await lstat(wt),
    shared: await inodes(wt, SHARED),
  };
}

export function actionFor(result: SurfaceSweepResult, worktree: string) {
  return result.actions.find((action) => action.candidate.target === worktree);
}

/** Directories in which the sweep ran `git update-index --refresh`. */
export function refreshedIn(fx: Fixture): string[] {
  return fx.commands
    .filter((command) => command.argv.includes("update-index"))
    .map((command) => command.cwd);
}
