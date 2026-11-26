import { createHash, randomBytes } from "node:crypto";
import {
  appendFile,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleTendCommand } from "#commands/tend/tend.ts";
import { formatTendReport } from "#commands/tend/tend-format.ts";
import { sweepDedupe, type SweepDedupeOptions } from "#lib/tend/dedupe.ts";
import {
  type CloneFile,
  cloneFileCopyOnWrite,
  directoryDevice,
} from "#lib/tend/dedupe/clone.ts";
import { parseAttributedPaths } from "#lib/tend/dedupe/verify.ts";
import { parseByteSize, resolveTendPaths } from "#lib/tend/paths.ts";
import { defaultCommandRunner } from "#lib/tend/process-probe.ts";
import { runTend } from "#lib/tend/runner.ts";
import type {
  CommandRunner,
  SurfaceSweepResult,
  TendRunReport,
} from "#lib/tend/types.ts";
import {
  computeWorktreeLastActivityMs,
  directoryExists,
} from "#lib/tend/worktrees-git.ts";
import { makeLiveness } from "./worktree-fixtures.ts";

const REAL_GIT_TIMEOUT_MS = 60_000;
const onApfs = process.platform === "darwin";

/** Real git, cut off from the developer's own configuration. */
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test Author",
  GIT_AUTHOR_EMAIL: "author@example.com",
  GIT_COMMITTER_NAME: "Test Author",
  GIT_COMMITTER_EMAIL: "author@example.com",
};

const runner: CommandRunner = (argv, options = {}) =>
  argv[0] === "git" || argv[0] === "python3"
    ? defaultCommandRunner(argv, {
        ...options,
        env: { ...GIT_ENV, ...options.env },
      })
    : // Herdr, ps, lsof and tailscale are not part of these tests.
      Promise.resolve({ exitCode: 127, stdout: "", stderr: "" });

async function git(cwd: string, ...args: string[]): Promise<string> {
  const res = await runner(["git", ...args], { cwd });
  if (res.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  }
  return res.stdout.trim();
}

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

async function physicalOffsets(files: readonly string[]): Promise<string[]> {
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

afterEach(async () => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

type Fixture = {
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
async function buildFixture(
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
async function reaperActivityMs(wt: string): Promise<number> {
  const signals = await computeWorktreeLastActivityMs({
    wtPath: wt,
    gitDir: await git(wt, "rev-parse", "--absolute-git-dir"),
    runner,
    changedPaths: ["untracked.bin", "sub/dir/nested.bin"],
  });
  return signals.lastActivityMs;
}

/** Where a worktree's clones are staged before being renamed into place. */
async function stagingDir(worktree: string): Promise<string> {
  const gitDir = await git(worktree, "rev-parse", "--absolute-git-dir");
  return path.join(gitDir, "tend-dedupe");
}

/**
 * A file's content as a short digest. Comparing digests keeps a failed
 * assertion from diffing hundreds of kilobytes.
 */
async function digest(file: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await Bun.file(file).bytes());
  return hash.digest("hex");
}

async function startOf(file: string): Promise<string> {
  const text = await Bun.file(file).text();
  return text.slice(0, 3);
}

async function inodes(dir: string, names: readonly string[]) {
  const result: Record<string, number> = {};
  for (const name of names) {
    const info = await lstat(path.join(dir, name));
    result[name] = info.ino;
  }
  return result;
}

const SHARED = ["big.bin", "tool.sh", "sub/dir/nested.bin"] as const;
const UNTOUCHED_IN_A = [
  "modified.bin",
  "grown.bin",
  "small.txt",
  "untracked.bin",
] as const;

function actionFor(result: SurfaceSweepResult, worktree: string) {
  return result.actions.find((action) => action.candidate.target === worktree);
}

describe.skipIf(!onApfs)("sweepDedupe on APFS", () => {
  it(
    "shares identical tracked files as clones and changes nothing else about them",
    async () => {
      const fx = await buildFixture();
      const statusBefore = await git(fx.a, "status", "--porcelain");
      const before = {
        big: await lstat(path.join(fx.a, "big.bin")),
        tool: await lstat(path.join(fx.a, "tool.sh")),
        nestedDir: await lstat(path.join(fx.a, "sub", "dir")),
        rootDir: await lstat(fx.a),
        shared: await inodes(fx.a, SHARED),
        untouched: await inodes(fx.a, UNTOUCHED_IN_A),
        content: await digest(path.join(fx.a, "big.bin")),
      };
      const copies = [fx.main, fx.a, fx.b].map((wt) =>
        path.join(wt, "big.bin"),
      );
      expect(new Set(await physicalOffsets(copies)).size).toBe(3);

      const result = await fx.sweep();

      // The three copies now sit on the same blocks.
      expect(new Set(await physicalOffsets(copies)).size).toBe(1);
      expect(result.warnings).toEqual([]);
      expect(result.inspectedCount).toBe(3);
      expect(actionFor(result, fx.main)).toBeUndefined();
      expect(actionFor(result, fx.a)).toMatchObject({
        status: "deduped",
        candidate: {
          kind: "worktree-files",
          metadata: { files: 3, bytes: 450_000, replacedFiles: 3 },
        },
      });
      expect(actionFor(result, fx.b)?.candidate.metadata).toMatchObject({
        replacedFiles: 5,
        replacedBytes: 660_000,
      });
      // Nothing differed from the plan, so there is nothing more to say.
      expect(actionFor(result, fx.a)?.detail).toBeUndefined();

      // Replaced files are new inodes with the old content, times and mode.
      const after = {
        big: await lstat(path.join(fx.a, "big.bin")),
        tool: await lstat(path.join(fx.a, "tool.sh")),
        nestedDir: await lstat(path.join(fx.a, "sub", "dir")),
        rootDir: await lstat(fx.a),
        shared: await inodes(fx.a, SHARED),
      };
      for (const name of SHARED) {
        expect(after.shared[name]).not.toBe(before.shared[name]);
      }
      expect(await digest(path.join(fx.a, "big.bin"))).toEqual(before.content);
      expect(Math.abs(after.big.mtimeMs - before.big.mtimeMs)).toBeLessThan(
        0.001,
      );
      expect(after.tool.mode).toBe(before.tool.mode);
      expect(after.tool.mode & 0o111).toBe(0o111);
      // Directory mtimes are activity signals; a rename must not move them.
      expect(after.nestedDir.mtimeMs).toBe(before.nestedDir.mtimeMs);
      expect(after.rootDir.mtimeMs).toBe(before.rootDir.mtimeMs);

      // Modified, grown, small and untracked files are the same files.
      expect(await inodes(fx.a, UNTOUCHED_IN_A)).toEqual(before.untouched);

      // Git sees no change, and the index was refreshed for the new inodes.
      expect(await git(fx.a, "status", "--porcelain")).toBe(statusBefore);
      expect(await git(fx.b, "status", "--porcelain")).toBe("?? untracked.bin");
      expect(await git(fx.b, "diff-files", "--name-only")).toBe("");
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "replaces nothing on a second run, and forgets worktrees that are gone",
    async () => {
      const fx = await buildFixture();
      await fx.sweep();
      const afterFirst = await inodes(fx.b, [...SHARED, "modified.bin"]);
      const stateDir = path.join(fx.tendDir, "dedupe");
      expect(await readdir(stateDir)).toHaveLength(2);

      const second = await fx.sweep();
      expect(second.actions).toEqual([]);
      expect(second.inspectedCount).toBe(3);
      expect(await inodes(fx.b, [...SHARED, "modified.bin"])).toEqual(
        afterFirst,
      );

      // Without its state a worktree is done again; the pass is repeatable.
      await rm(stateDir, { recursive: true });
      const rebuilt = await fx.sweep();
      expect(actionFor(rebuilt, fx.b)?.status).toBe("deduped");

      await git(fx.main, "worktree", "remove", "--force", fx.b);
      await fx.sweep();
      expect(await readdir(stateDir)).toHaveLength(1);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "reports what it would share in a dry run and changes nothing",
    async () => {
      const fx = await buildFixture();
      const before = await inodes(fx.b, SHARED);
      const dirBefore = await lstat(fx.b);

      const result = await fx.sweep({ apply: false });

      expect(actionFor(result, fx.a)).toMatchObject({
        status: "planned",
        candidate: { metadata: { files: 3, bytes: 450_000 } },
      });
      expect(actionFor(result, fx.b)).toMatchObject({
        status: "planned",
        candidate: { metadata: { files: 5, bytes: 660_000 } },
      });
      expect(await inodes(fx.b, SHARED)).toEqual(before);
      const dirAfter = await lstat(fx.b);
      expect(dirAfter.mtimeMs).toBe(dirBefore.mtimeMs);
      expect(await directoryExists(path.join(fx.tendDir, "dedupe"))).toBe(
        false,
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "leaves a file alone when it changes between the check and the rename",
    async () => {
      const fx = await buildFixture();
      const raced = path.join(fx.a, "big.bin");
      const stagingA = await stagingDir(fx.a);
      const inodeBefore = await inodes(fx.a, ["big.bin"]);
      // The seam: an edit lands while the clone is being prepared.
      const cloneFile: CloneFile = async (source, destination) => {
        await cloneFileCopyOnWrite(source, destination);
        if (source.endsWith("/big.bin") && destination.startsWith(stagingA)) {
          await appendFile(raced, "edited mid-run");
        }
      };

      const result = await fx.sweep({ cloneFile });

      expect(await inodes(fx.a, ["big.bin"])).toEqual(inodeBefore);
      const text = await Bun.file(raced).text();
      expect(text.endsWith("edited mid-run")).toBe(true);
      expect(actionFor(result, fx.a)).toMatchObject({
        status: "deduped",
        candidate: { metadata: { files: 3, replacedFiles: 2 } },
      });
      expect(actionFor(result, fx.a)?.detail).toContain(
        "1 file(s) changed during the run and were left alone",
      );
      // The half-made clone is gone and the edit shows as an ordinary change.
      expect(await git(fx.a, "status", "--porcelain")).toContain("M big.bin");
      expect(await git(fx.a, "status", "--porcelain")).not.toContain(
        "tend-dedupe",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );
});

describe.skipIf(!onApfs)(
  "sweepDedupe and bytes the index cannot vouch for",
  () => {
    it(
      "does not clone from a worktree that switched commits after its index was read",
      async () => {
        const fx = await buildFixture();
        // A second commit where big.bin has other content of the same size.
        await git(fx.main, "checkout", "-q", "-b", "next");
        await Bun.write(path.join(fx.main, "big.bin"), randomBytes(200_000));
        await git(fx.main, "commit", "-q", "-am", "next");
        await git(fx.main, "checkout", "-q", "main");
        const original = await digest(path.join(fx.a, "big.bin"));
        const statusA = await git(fx.a, "status", "--porcelain");
        let switched = false;
        // The seam: the main checkout moves on right after its pass listed it.
        const switching: CommandRunner = async (argv, options = {}) => {
          const result = await fx.runner(argv, options);
          const listsWholeIndex =
            argv.includes("ls-files") && !argv.includes("--");
          if (!switched && listsWholeIndex && options.cwd === fx.main) {
            switched = true;
            await git(fx.main, "checkout", "-q", "next");
          }
          return result;
        };

        const result = await fx.sweep({ runner: switching });

        expect(switched).toBe(true);
        const next = await digest(path.join(fx.main, "big.bin"));
        expect(next).not.toEqual(original);
        // Both targets still hold the content their own index names.
        expect(await digest(path.join(fx.a, "big.bin"))).toEqual(original);
        expect(await digest(path.join(fx.b, "big.bin"))).toEqual(original);
        expect(await git(fx.a, "status", "--porcelain")).toBe(statusA);
        expect(await git(fx.b, "status", "--porcelain")).toBe(
          "?? untracked.bin",
        );
        expect(result.warnings).toEqual([
          "1 file(s) left alone: the copy they would be cloned from was no longer the blob its worktree listed; a later run takes them",
        ]);
        // The two worktrees share their copy with each other, not with main.
        const [main, a, b] = await physicalOffsets(
          [fx.main, fx.a, fx.b].map((wt) => path.join(wt, "big.bin")),
        );
        expect(a).toBe(b);
        expect(main).not.toBe(a);
        // Files the switch did not change are still shared with main.
        const tool = await physicalOffsets(
          [fx.main, fx.b].map((wt) => path.join(wt, "tool.sh")),
        );
        expect(tool[0]).toBe(tool[1]);
      },
      REAL_GIT_TIMEOUT_MS,
    );

    it(
      "leaves a path with a clean or smudge filter alone, though every copy is clean",
      async () => {
        // A filter that stores upper case: the blob says nothing about the
        // case of the bytes a worktree holds.
        const fx = await buildFixture(async (main) => {
          await git(main, "config", "filter.upper.clean", "tr a-z A-Z");
          await git(main, "config", "filter.upper.smudge", "cat");
          await Bun.write(
            path.join(main, ".gitattributes"),
            "*.dat filter=upper\n",
          );
          await Bun.write(path.join(main, "data.dat"), "a".repeat(100_000));
        });
        const copies = [fx.main, fx.a, fx.b].map((wt) =>
          path.join(wt, "data.dat"),
        );
        // main kept what was written; a checked out the stored upper case; b
        // is put back to lower case. All three are clean and the same size.
        await Bun.write(path.join(fx.b, "data.dat"), "a".repeat(100_000));
        expect(await Promise.all(copies.map((file) => startOf(file)))).toEqual([
          "aaa",
          "AAA",
          "aaa",
        ]);
        const before = await Promise.all(copies.map((file) => digest(file)));
        for (const wt of [fx.main, fx.a, fx.b]) {
          expect(await git(wt, "status", "--porcelain", "--", "data.dat")).toBe(
            "",
          );
        }
        const inodesBefore = await Promise.all(
          [fx.main, fx.a, fx.b].map((wt) => inodes(wt, ["data.dat"])),
        );

        const result = await fx.sweep();

        expect(await Promise.all(copies.map((file) => digest(file)))).toEqual(
          before,
        );
        expect(await Promise.all(copies.map((file) => startOf(file)))).toEqual([
          "aaa",
          "AAA",
          "aaa",
        ]);
        expect(
          await Promise.all(
            [fx.main, fx.a, fx.b].map((wt) => inodes(wt, ["data.dat"])),
          ),
        ).toEqual(inodesBefore);
        expect(new Set(await physicalOffsets(copies)).size).toBe(3);
        expect(result.warnings).toEqual([
          "2 file(s) left alone: a filter, ident or working-tree-encoding attribute means equal blobs do not prove equal files",
        ]);
        expect(actionFor(result, fx.b)?.candidate.metadata).toMatchObject({
          replacedFiles: 5,
          filteredFiles: 1,
        });
        // Unfiltered files are shared as before.
        const big = await physicalOffsets(
          [fx.main, fx.b].map((wt) => path.join(wt, "big.bin")),
        );
        expect(big[0]).toBe(big[1]);
      },
      REAL_GIT_TIMEOUT_MS,
    );
  },
);

describe("dedupe attribute parsing", () => {
  it("picks out paths with a filter, ident or working-tree-encoding in effect", () => {
    const records = [
      ["plain.bin", "filter", "unspecified"],
      ["plain.bin", "ident", "unspecified"],
      ["plain.bin", "working-tree-encoding", "unspecified"],
      ["off.bin", "filter", "unset"],
      ["off.bin", "ident", "unset"],
      ["lfs.bin", "filter", "lfs"],
      ["stamp.c", "ident", "set"],
      ["wide.txt", "working-tree-encoding", "UTF-16"],
    ];
    const output = records.map((record) => `${record.join("\0")}\0`).join("");
    expect([...parseAttributedPaths(output)].sort()).toEqual([
      "lfs.bin",
      "stamp.c",
      "wide.txt",
    ]);
    expect(parseAttributedPaths("").size).toBe(0);
  });
});

describe.skipIf(!onApfs)("sweepDedupe scope", () => {
  it(
    "limits replacement to --worktree while every worktree still lends files",
    async () => {
      const fx = await buildFixture();
      const aBefore = await inodes(fx.a, SHARED);

      const result = await fx.sweep({ worktree: fx.b });

      expect(result.inspectedCount).toBe(1);
      expect(result.actions.map((action) => action.candidate.target)).toEqual([
        fx.b,
      ]);
      expect(actionFor(result, fx.b)?.candidate.metadata).toMatchObject({
        replacedFiles: 5,
      });
      expect(await inodes(fx.a, SHARED)).toEqual(aBefore);
      const offsets = await physicalOffsets([
        path.join(fx.main, "big.bin"),
        path.join(fx.b, "big.bin"),
      ]);
      expect(offsets[0]).toBe(offsets[1]);

      await expect(
        fx.sweep({ worktree: path.join(fx.root, "nowhere") }),
      ).rejects.toThrow("is not a worktree that can be deduplicated");
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "uses another clean copy when the main checkout's is modified",
    async () => {
      const fx = await buildFixture();
      await Bun.write(path.join(fx.main, "big.bin"), randomBytes(200_000));
      const mainBefore = await digest(path.join(fx.main, "big.bin"));

      await fx.sweep();

      const [main, a, b] = await physicalOffsets(
        [fx.main, fx.a, fx.b].map((wt) => path.join(wt, "big.bin")),
      );
      expect(a).toBe(b);
      expect(main).not.toBe(a);
      expect(await digest(path.join(fx.main, "big.bin"))).toEqual(mainBefore);
      expect(await git(fx.b, "status", "--porcelain")).toBe("?? untracked.bin");
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "skips worktrees mid git operation or named by a Forum notice, and honors the minimum size",
    async () => {
      const fx = await buildFixture();
      const gitDirA = await git(fx.a, "rev-parse", "--absolute-git-dir");
      await Bun.write(path.join(gitDirA, "MERGE_HEAD"), "0\n");
      const aBefore = await inodes(fx.a, SHARED);
      const bBefore = await inodes(fx.b, SHARED);

      const held = await fx.sweep({
        liveness: makeLiveness({
          platform: process.platform,
          forumNoticePaths: new Set([fx.b]),
        }),
      });
      expect(held.actions).toEqual([]);
      expect(held.inspectedCount).toBe(1);
      expect(await inodes(fx.a, SHARED)).toEqual(aBefore);
      expect(await inodes(fx.b, SHARED)).toEqual(bBefore);

      const small = await fx.sweep({ apply: false, minSizeBytes: 1024 });
      expect(actionFor(small, fx.b)?.candidate.metadata).toMatchObject({
        files: 6,
        bytes: 661_500,
      });
      const large = await fx.sweep({ apply: false, minSizeBytes: 160_000 });
      expect(actionFor(large, fx.b)?.candidate.metadata).toMatchObject({
        files: 1,
        bytes: 200_000,
      });
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "stages clones in the git directory, where git never sees them",
    async () => {
      const fx = await buildFixture();
      const stagingB = await stagingDir(fx.b);
      const statusBefore = await git(fx.b, "status", "--porcelain");
      const seen: { destination: string; status: string }[] = [];
      // The seam: look at the worktree while a clone exists but is not yet
      // renamed into place.
      const cloneFile: CloneFile = async (source, destination) => {
        await cloneFileCopyOnWrite(source, destination);
        if (destination.startsWith(stagingB)) {
          seen.push({
            destination,
            status: await git(fx.b, "status", "--porcelain", "--ignored"),
          });
        }
      };

      await fx.sweep({ cloneFile, worktree: fx.b });

      expect(seen).toHaveLength(5);
      for (const moment of seen) {
        expect(path.dirname(moment.destination)).toBe(stagingB);
        expect(moment.status).toBe(statusBefore);
      }
      // Nothing is left behind in the git directory either.
      expect(await directoryExists(stagingB)).toBe(false);
      expect(await git(fx.b, "status", "--porcelain")).toBe(statusBefore);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "removes a clone left behind by a run that died, and nothing else",
    async () => {
      const fx = await buildFixture();
      const stagingA = await stagingDir(fx.a);
      const stagingB = await stagingDir(fx.b);
      await Bun.write(path.join(stagingA, "999999-7"), randomBytes(10));
      await Bun.write(path.join(stagingB, "999999-3"), randomBytes(10));
      await Bun.write(path.join(stagingB, "notes.txt"), "not ours");

      await fx.sweep();

      expect(await directoryExists(stagingA)).toBe(false);
      expect(await readdir(stagingB)).toEqual(["notes.txt"]);
      expect(await git(fx.b, "diff-files", "--name-only")).toBe("");
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "skips a worktree whose git directory is on another volume than its files",
    async () => {
      const fx = await buildFixture();
      const stagingA = await stagingDir(fx.a);
      const aBefore = await inodes(fx.a, SHARED);
      const attempts: string[] = [];

      const result = await fx.sweep({
        deviceOf: (directory) =>
          directory === stagingA
            ? Promise.resolve(-1)
            : directoryDevice(directory),
        cloneFile: async (source, destination) => {
          attempts.push(destination);
          await cloneFileCopyOnWrite(source, destination);
        },
      });

      expect(result.warnings).toEqual([
        `Skipped ${fx.a}: its git directory is on a different volume than big.bin, so a clone cannot be renamed into place`,
      ]);
      expect(actionFor(result, fx.a)).toBeUndefined();
      expect(await inodes(fx.a, SHARED)).toEqual(aBefore);
      // No sibling file is tried instead.
      expect(attempts.filter((p) => p.startsWith(fx.a))).toEqual([]);
      expect(attempts.filter((p) => p.startsWith(stagingA))).toEqual([]);
      expect(await directoryExists(stagingA)).toBe(false);
      expect(actionFor(result, fx.b)?.status).toBe("deduped");

      // A dry run says the same without creating anything.
      const other = await buildFixture();
      const gitDirA = await git(other.a, "rev-parse", "--absolute-git-dir");
      const dryRun = await other.sweep({
        apply: false,
        deviceOf: (directory) =>
          directory === gitDirA
            ? Promise.resolve(-1)
            : directoryDevice(directory),
      });
      expect(dryRun.warnings.join("\n")).toContain(`Skipped ${other.a}:`);
      expect(await directoryExists(await stagingDir(other.a))).toBe(false);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "leaves the reaper's activity signals where they were",
    async () => {
      const fx = await buildFixture();
      const before = {
        a: await reaperActivityMs(fx.a),
        b: await reaperActivityMs(fx.b),
      };

      const result = await fx.sweep();

      expect(actionFor(result, fx.a)?.status).toBe("deduped");
      expect(actionFor(result, fx.b)?.status).toBe("deduped");
      expect(await reaperActivityMs(fx.a)).toBe(before.a);
      expect(await reaperActivityMs(fx.b)).toBe(before.b);
    },
    REAL_GIT_TIMEOUT_MS,
  );
});

/** Directories in which the sweep ran `git update-index --refresh`. */
function refreshedIn(fx: Fixture): string[] {
  return fx.commands
    .filter((command) => command.argv.includes("update-index"))
    .map((command) => command.cwd);
}

describe.skipIf(!onApfs)("sweepDedupe index refresh", () => {
  it(
    "refreshes the index only where nobody is working",
    async () => {
      const fx = await buildFixture();
      const result = await fx.sweep({
        liveness: makeLiveness({
          platform: process.platform,
          hcTerminals: [{ address: "t1", cwd: path.join(fx.a, "sub") }],
        }),
      });

      expect(refreshedIn(fx)).toEqual([fx.b]);
      expect(actionFor(result, fx.a)).toMatchObject({
        status: "deduped",
        candidate: { metadata: { replacedFiles: 3, refresh: "live" } },
        detail:
          "index left for the live session's next git status (live Herdr terminal)",
      });
      expect(actionFor(result, fx.b)?.candidate.metadata).toMatchObject({
        refresh: "refreshed",
      });
      // The live worktree is still clean; git just has not re-read the
      // replaced files yet, and its own next status does that.
      expect(await git(fx.a, "diff-files", "--name-only")).toContain("big.bin");
      const statusA = await git(fx.a, "status", "--porcelain");
      expect(statusA).not.toContain("big.bin");
      expect(await git(fx.a, "diff-files", "--name-only")).not.toContain(
        "big.bin",
      );
      expect(await git(fx.b, "diff-files", "--name-only")).toBe("");
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "treats a process, the caller, and a live Claude agent lock as someone working",
    async () => {
      const fx = await buildFixture();
      await git(
        fx.main,
        "worktree",
        "lock",
        "--reason",
        `claude agent agent-t1 (pid ${String(process.pid)})`,
        fx.a,
      );
      const result = await fx.sweep({ selfCwd: path.join(fx.b, "sub", "dir") });
      expect(refreshedIn(fx)).toEqual([]);
      expect(actionFor(result, fx.a)?.detail).toContain(
        "locked by a live Claude agent",
      );
      expect(actionFor(result, fx.b)?.detail).toContain(
        "caller working directory",
      );

      // A lock whose agent is gone does not make the worktree live.
      const other = await buildFixture();
      await git(
        other.main,
        "worktree",
        "lock",
        "--reason",
        "claude agent agent-t2 (pid 999999)",
        other.a,
      );
      await other.sweep({
        liveness: makeLiveness({
          platform: process.platform,
          processCwds: new Set([other.b]),
        }),
      });
      expect(refreshedIn(other)).toEqual([other.a]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "never refreshes with --no-refresh, and says what a dry run would do",
    async () => {
      const fx = await buildFixture();
      const live = makeLiveness({
        platform: process.platform,
        processCwds: new Set([fx.a]),
      });
      const dryRun = await fx.sweep({ apply: false, liveness: live });
      expect(actionFor(dryRun, fx.a)?.candidate.metadata).toMatchObject({
        refresh: "live",
      });
      expect(actionFor(dryRun, fx.b)?.candidate.metadata).toMatchObject({
        refresh: "refreshed",
      });

      const result = await fx.sweep({ refreshIndex: false, liveness: live });
      expect(refreshedIn(fx)).toEqual([]);
      expect(actionFor(result, fx.a)?.candidate.metadata).toMatchObject({
        refresh: "disabled",
      });
      expect(actionFor(result, fx.b)).toMatchObject({
        status: "deduped",
        detail: "index not refreshed (--no-refresh)",
      });
      expect(await git(fx.b, "status", "--porcelain")).toBe("?? untracked.bin");
    },
    REAL_GIT_TIMEOUT_MS,
  );
});

describe("dedupe within a tend run", () => {
  it("is left out of tend status unless --only names it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tend-dedupe-status-"));
    tempDirs.push(root);
    const calls: string[][] = [];
    const base = {
      mode: "status" as const,
      paths: resolveTendPaths({ tendDir: path.join(root, "tend") }),
      homeDir: root,
      gitDirs: [path.join(root, "git")],
      livenessOverride: makeLiveness({ platform: "darwin" }),
      statDisk: () => Promise.resolve(null),
      runner: ((argv) => {
        calls.push([...argv]);
        return Promise.resolve({ exitCode: 127, stdout: "", stderr: "" });
      }) satisfies CommandRunner,
    };

    const byDefault = await runTend(base);
    const dedupe = byDefault.surfaces.find(
      (surface) => surface.surface === "dedupe",
    );
    expect(dedupe).toMatchObject({
      skippedReason: "planning pass; run `toolkit tend dedupe`",
      inspectedCount: 0,
      actions: [],
    });
    expect(formatTendReport(byDefault)).toContain(
      "SKIPPED (planning pass; run `toolkit tend dedupe`)",
    );

    const named = await runTend({ ...base, surfaces: ["dedupe"] });
    expect(named.surfaces).toEqual([
      expect.objectContaining({ surface: "dedupe", inspectedCount: 0 }),
    ]);
    expect(named.surfaces[0]?.skippedReason).toBeUndefined();

    // A run, unlike a status report, plans dedupe by default.
    const run = await runTend({ ...base, mode: "run" });
    expect(
      run.surfaces.find((surface) => surface.surface === "dedupe")
        ?.skippedReason,
    ).toBeUndefined();
  });

  it("always runs after the worktree reaper, whatever order --only gave", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tend-dedupe-order-"));
    tempDirs.push(root);
    const report = await runTend({
      mode: "run",
      surfaces: ["dedupe", "leases", "worktrees"],
      paths: resolveTendPaths({ tendDir: path.join(root, "tend") }),
      homeDir: root,
      gitDirs: [path.join(root, "git")],
      livenessOverride: makeLiveness({ platform: "linux" }),
      statDisk: () => Promise.resolve(null),
      runner,
    });
    expect(report.surfaces.map((surface) => surface.surface)).toEqual([
      "worktrees",
      "dedupe",
      "leases",
    ]);
    expect(report.surfaces[1]?.skippedReason).toContain("only runs on macOS");
  });
});

function codedError(code: string): Error {
  return Object.assign(new Error(`${code}: clone refused`), { code });
}

describe("sweepDedupe when it cannot run", () => {
  it(
    "is skipped off macOS and held by a Forum hold",
    async () => {
      const fx = await buildFixture();
      const elsewhere = await fx.sweep({
        liveness: makeLiveness({ platform: "linux" }),
      });
      expect(elsewhere.skippedReason).toContain("only runs on macOS");
      expect(elsewhere.actions).toEqual([]);

      const held = await fx.sweep({
        liveness: makeLiveness({
          platform: "darwin",
          holdSurfaces: new Map([["dedupe", "Forum notice query unavailable"]]),
        }),
      });
      expect(held.heldReason).toBe("Forum notice query unavailable");
      expect(await directoryExists(path.join(fx.tendDir, "dedupe"))).toBe(
        false,
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "stops at the first refused clone instead of copying, and reports a failed clone",
    async () => {
      const fx = await buildFixture();
      const before = await inodes(fx.b, SHARED);
      const attempts: string[] = [];
      const unsupported = await fx.sweep({
        liveness: makeLiveness({ platform: "darwin" }),
        cloneFile: (_source, destination) => {
          attempts.push(destination);
          return Promise.reject(codedError("ENOTSUP"));
        },
      });
      expect(attempts).toHaveLength(1);
      expect(unsupported.actions).toEqual([]);
      expect(unsupported.warnings.join("\n")).toContain(
        "Copy-on-write clones are not supported on device",
      );
      expect(await inodes(fx.b, SHARED)).toEqual(before);

      const failed = await fx.sweep({
        liveness: makeLiveness({ platform: "darwin" }),
        cloneFile: () => Promise.reject(codedError("EACCES")),
      });
      expect(actionFor(failed, fx.b)).toMatchObject({ status: "failed" });
      expect(actionFor(failed, fx.b)?.detail).toContain(
        "5 file(s) could not be replaced",
      );
      expect(await inodes(fx.b, SHARED)).toEqual(before);
      expect(await git(fx.b, "status", "--porcelain")).toBe("?? untracked.bin");
    },
    REAL_GIT_TIMEOUT_MS,
  );
});

function captureLog(): () => string {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  return () => lines.join("\n");
}

describe("toolkit tend dedupe", () => {
  it("reads sizes with binary suffixes", () => {
    expect(parseByteSize("64k")).toBe(65_536);
    expect(parseByteSize("1M")).toBe(1_048_576);
    expect(parseByteSize("4096")).toBe(4096);
    expect(parseByteSize("2g")).toBe(2 * 1024 ** 3);
    expect(() => parseByteSize("64kb")).toThrow('Invalid size "64kb"');
    expect(() => parseByteSize("-1")).toThrow("Invalid size");
  });

  it.skipIf(!onApfs)(
    "forwards --git-dir, --worktree and --dedupe-min-size, and is a dry run without --apply",
    async () => {
      const fx = await buildFixture();
      const before = await inodes(fx.b, SHARED);
      const output = captureLog();
      const injected = {
        paths: resolveTendPaths({ tendDir: fx.tendDir }),
        runner,
      };

      await handleTendCommand(
        "dedupe",
        [
          "--git-dir",
          fx.gitRoot,
          "--worktree",
          fx.b,
          "--dedupe-min-size",
          "1k",
          "--offline",
          "--json",
        ],
        injected,
      );

      const report: TendRunReport = JSON.parse(output());
      expect(report.mode).toBe("dry-run");
      expect(report.surfaces.map((surface) => surface.surface)).toEqual([
        "dedupe",
      ]);
      expect(report.surfaces[0]?.actions).toEqual([
        expect.objectContaining({
          status: "planned",
          candidate: expect.objectContaining({
            target: fx.b,
            metadata: expect.objectContaining({ files: 6, bytes: 661_500 }),
          }),
        }),
      ]);
      expect(report.totals).toEqual({ candidates: 1, removed: 0, failed: 0 });
      expect(await inodes(fx.b, SHARED)).toEqual(before);
      expect(formatTendReport(report)).toContain(
        "Dedupe: would share 6 file(s), 646.0 KiB in 1 worktree(s); index would be refreshed in 1",
      );
      expect(formatTendReport(report)).toContain(
        "[WOULD SHARE] (dedupe/worktree-files)",
      );

      await expect(
        handleTendCommand(
          "dedupe",
          ["--git-dir", fx.gitRoot, "--dedupe-min-size", "big", "--offline"],
          injected,
        ),
      ).rejects.toThrow('Invalid size "big"');
      await expect(
        handleTendCommand(
          "dedupe",
          ["--git-dir", fx.gitRoot, "--worktree", fx.root, "--offline"],
          injected,
        ),
      ).rejects.toThrow("is not a worktree that can be deduplicated");
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it.skipIf(!onApfs)(
    "applies with --apply and says what it shared, not what it removed",
    async () => {
      const fx = await buildFixture();
      const output = captureLog();

      await handleTendCommand(
        "dedupe",
        ["--git-dir", fx.gitRoot, "--apply", "--offline"],
        { paths: resolveTendPaths({ tendDir: fx.tendDir }), runner: fx.runner },
      );
      expect(refreshedIn(fx).sort()).toEqual([fx.a, fx.b]);

      expect(output()).toContain("toolkit tend — APPLY");
      expect(output()).toContain(
        "Dedupe: shared 8 file(s), 1.1 MiB in 2 worktree(s); index refreshed in 2",
      );
      expect(output()).toContain(
        `[SHARED] (dedupe/worktree-files) ${fx.b} — 5 file(s), 644.5 KiB identical to another worktree's`,
      );
      expect(output()).toContain("Totals: 2 candidate(s), 0 removed, 0 failed");
      expect(output()).not.toContain("[REMOVED]");
      expect(output()).not.toContain("WOULD REMOVE");
      expect(process.exitCode ?? 0).toBe(0);
      expect(await git(fx.b, "status", "--porcelain")).toBe("?? untracked.bin");
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it.skipIf(!onApfs)(
    "forwards --no-refresh",
    async () => {
      const fx = await buildFixture();
      const output = captureLog();

      await handleTendCommand(
        "dedupe",
        ["--git-dir", fx.gitRoot, "--apply", "--no-refresh", "--offline"],
        { paths: resolveTendPaths({ tendDir: fx.tendDir }), runner: fx.runner },
      );

      expect(refreshedIn(fx)).toEqual([]);
      expect(output()).toContain(
        "Dedupe: shared 8 file(s), 1.1 MiB in 2 worktree(s); index skipped by --no-refresh in 2",
      );
      expect(await git(fx.a, "status", "--porcelain")).not.toContain("big.bin");
    },
    REAL_GIT_TIMEOUT_MS,
  );
});
