import { randomBytes } from "node:crypto";
import { chmod, link, lstat, open, rename, symlink } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type CloneFile,
  cloneFileCopyOnWrite,
} from "#lib/tend/dedupe/clone.ts";
import {
  parseOpenFiles,
  parseXattrPaths,
  statusTrustProblem,
} from "#lib/tend/dedupe/metadata.ts";
import type { DedupeContext } from "#lib/tend/dedupe/types.ts";
import {
  actionFor,
  buildFixture,
  digest,
  type Fixture,
  git,
  inodes,
  onApfs,
  physicalOffsets,
  PLAIN_FILE_PROBES,
  removeFixtures,
  SHARED,
  UNTOUCHED_IN_A,
} from "./dedupe-fixtures.ts";
import { REAL_GIT_TIMEOUT_MS, realGitRunner } from "./real-git.ts";

afterEach(removeFixtures);

/** Run a system tool the fixtures need for setup; fail loudly if it fails. */
function system(...argv: string[]): string {
  const res = Bun.spawnSync(argv);
  if (res.exitCode !== 0) {
    throw new Error(`${argv.join(" ")} failed: ${res.stderr.toString()}`);
  }
  return res.stdout.toString().trim();
}

function copiesOf(fx: Fixture, name: string): string[] {
  return [fx.main, fx.a, fx.b].map((wt) => path.join(wt, name));
}

async function digestsOf(files: readonly string[]): Promise<string[]> {
  const digests: string[] = [];
  for (const file of files) {
    digests.push(await digest(file));
  }
  return digests;
}

/** How many distinct places on disk the files' first bytes occupy. */
async function distinctBlocks(files: readonly string[]): Promise<number> {
  return new Set(await physicalOffsets(files)).size;
}

/** The seam for a clone that comes out the wrong size for one file. */
const wrongSizeForBigBin: CloneFile = async (source, destination) => {
  if (source.endsWith("/big.bin")) {
    await Bun.write(destination, randomBytes(10));
  } else {
    await cloneFileCopyOnWrite(source, destination);
  }
};

/** A context for asking one worktree's git about itself. */
function contextFor(apply: boolean): DedupeContext {
  return {
    runner: realGitRunner(),
    apply,
    minSizeBytes: 0,
    stateDir: "/unused",
    cloneFile: cloneFileCopyOnWrite,
    refreshIndex: false,
    isPidAlive: () => false,
    deviceOf: () => Promise.resolve(null),
    unsupportedDevices: new Map(),
    blobSizes: new Map(),
    currentUid: 0,
    probes: PLAIN_FILE_PROBES,
    dryRunOpenFiles: {},
  };
}

function trustProblem(worktree: string): Promise<string | null> {
  return statusTrustProblem(
    { path: worktree, isTarget: true, gitDir: path.join(worktree, ".git") },
    contextFor(false),
  );
}

describe.skipIf(!onApfs)("sweepDedupe and an inherited git context", () => {
  it(
    "reads each worktree itself even when GIT_DIR and GIT_WORK_TREE point at another checkout",
    async () => {
      const fx = await buildFixture();
      // What a git hook, or a shell that exported these, hands to a child.
      const inherited = realGitRunner({
        GIT_DIR: path.join(fx.main, ".git"),
        GIT_WORK_TREE: fx.main,
        GIT_INDEX_FILE: path.join(fx.main, ".git", "index"),
      });
      // The hazard is real here: with that context, status in `a` describes
      // the clean main checkout and hides `a`'s own modified file.
      const misled = await inherited(
        ["git", "status", "--porcelain", "--untracked-files=no"],
        { cwd: fx.a },
      );
      expect(misled.stdout).toBe("");
      expect(await git(fx.a, "status", "--porcelain")).toContain(
        "modified.bin",
      );
      const untouched = await inodes(fx.a, UNTOUCHED_IN_A);
      const modified = await digest(path.join(fx.a, "modified.bin"));

      const result = await fx.sweep({ runner: inherited });

      // `a`'s rewritten file has the size of the committed one. It stays.
      expect(await digest(path.join(fx.a, "modified.bin"))).toBe(modified);
      expect(await inodes(fx.a, UNTOUCHED_IN_A)).toEqual(untouched);
      expect(actionFor(result, fx.a)?.candidate.metadata).toMatchObject({
        replacedFiles: 3,
      });
      expect(actionFor(result, fx.b)?.candidate.metadata).toMatchObject({
        replacedFiles: 5,
      });
      expect(result.warnings).toEqual([]);
    },
    REAL_GIT_TIMEOUT_MS,
  );
});

describe.skipIf(!onApfs)("sweepDedupe state and writes in place", () => {
  it(
    "shares a file again after it was rewritten in place, and only that file",
    async () => {
      const fx = await buildFixture();
      await fx.sweep();
      const rewritten = path.join(fx.b, "big.bin");
      const afterFirst = await inodes(fx.b, [...SHARED, "modified.bin"]);
      expect(await distinctBlocks(copiesOf(fx, "big.bin"))).toBe(1);

      // A tool writes the same bytes back through the same inode. Size,
      // inode and index entry do not change, but the blocks are its own.
      const bytes = await Bun.file(rewritten).bytes();
      const handle = await open(rewritten, "r+");
      await handle.write(bytes, 0, bytes.length, 0);
      await handle.close();
      expect(await inodes(fx.b, ["big.bin"])).toEqual({
        "big.bin": afterFirst["big.bin"],
      });
      expect(await distinctBlocks(copiesOf(fx, "big.bin"))).toBe(2);

      const second = await fx.sweep();

      expect(actionFor(second, fx.a)).toBeUndefined();
      expect(actionFor(second, fx.b)?.candidate.metadata).toMatchObject({
        files: 1,
        replacedFiles: 1,
        replacedBytes: 200_000,
      });
      expect(await distinctBlocks(copiesOf(fx, "big.bin"))).toBe(1);
      const afterSecond = await inodes(fx.b, [...SHARED, "modified.bin"]);
      expect(afterSecond["big.bin"]).not.toBe(afterFirst["big.bin"]);
      expect({ ...afterSecond, "big.bin": 0 }).toEqual({
        ...afterFirst,
        "big.bin": 0,
      });
      expect(await git(fx.b, "status", "--porcelain")).toBe("?? untracked.bin");

      // With nothing rewritten, a further run finds nothing to do.
      const third = await fx.sweep();
      expect(third.actions).toEqual([]);
    },
    REAL_GIT_TIMEOUT_MS,
  );
});

describe.skipIf(!onApfs)("sweepDedupe state and the copy cloned from", () => {
  it(
    "shares a file again after the copy it was cloned from was rewritten in place",
    async () => {
      const fx = await buildFixture();
      await fx.sweep();
      const canonical = path.join(fx.main, "big.bin");
      const afterFirst = {
        a: await inodes(fx.a, SHARED),
        b: await inodes(fx.b, [...SHARED, "modified.bin"]),
      };
      expect(await distinctBlocks(copiesOf(fx, "big.bin"))).toBe(1);

      // The main checkout's file gets the same bytes written back. Neither
      // clone is touched, yet neither shares blocks with it any more.
      const bytes = await Bun.file(canonical).bytes();
      const handle = await open(canonical, "r+");
      await handle.write(bytes, 0, bytes.length, 0);
      await handle.close();
      const [main, a, b] = await physicalOffsets(copiesOf(fx, "big.bin"));
      expect(a).toBe(b);
      expect(main).not.toBe(a);

      const second = await fx.sweep();

      expect(await distinctBlocks(copiesOf(fx, "big.bin"))).toBe(1);
      for (const wt of [fx.a, fx.b]) {
        expect(actionFor(second, wt)?.candidate.metadata).toMatchObject({
          files: 1,
          replacedFiles: 1,
        });
      }
      // Only that file was replaced again; the other pairs were left alone.
      const afterSecond = {
        a: await inodes(fx.a, SHARED),
        b: await inodes(fx.b, [...SHARED, "modified.bin"]),
      };
      expect(afterSecond.a["big.bin"]).not.toBe(afterFirst.a["big.bin"]);
      expect(afterSecond.b["big.bin"]).not.toBe(afterFirst.b["big.bin"]);
      expect({ ...afterSecond.a, "big.bin": 0 }).toEqual({
        ...afterFirst.a,
        "big.bin": 0,
      });
      expect({ ...afterSecond.b, "big.bin": 0 }).toEqual({
        ...afterFirst.b,
        "big.bin": 0,
      });

      const third = await fx.sweep();
      expect(third.actions).toEqual([]);
    },
    REAL_GIT_TIMEOUT_MS,
  );
});

describe.skipIf(!onApfs)("sweepDedupe and line endings", () => {
  it(
    "never treats files as equal because they normalize to the same blob",
    async () => {
      const lf = "a\nb\n".repeat(20_000);
      const fx = await buildFixture(async (main) => {
        await Bun.write(
          path.join(main, ".gitattributes"),
          "swap.txt text\nplain.txt text\ncrlf.txt text eol=crlf\n",
        );
        // 100,000 bytes that are committed as the 80,000-byte LF blob.
        await Bun.write(path.join(main, "swap.txt"), "a\r\nb\n".repeat(20_000));
        await Bun.write(path.join(main, "plain.txt"), "plain\n".repeat(20_000));
        await Bun.write(path.join(main, "crlf.txt"), "line\n".repeat(20_000));
      });
      // The other worktree holds the opposite line endings: also 100,000
      // bytes, also clean against the same blob, and not the same bytes.
      await Bun.write(path.join(fx.b, "swap.txt"), "a\nb\r\n".repeat(20_000));
      await git(fx.b, "add", "swap.txt");
      const swap = copiesOf(fx, "swap.txt");
      const crlf = copiesOf(fx, "crlf.txt");
      for (const wt of [fx.main, fx.a, fx.b]) {
        expect(
          await git(wt, "status", "--porcelain", "--untracked-files=no"),
        ).not.toMatch(/swap\.txt|crlf\.txt|plain\.txt/u);
      }
      const sizes = await Promise.all(
        swap.map(async (file) => {
          const info = await lstat(file);
          return info.size;
        }),
      );
      expect(sizes).toEqual([100_000, lf.length, 100_000]);
      const before = {
        swap: await digestsOf(swap),
        crlf: await digestsOf(crlf),
      };
      expect(before.swap[0]).not.toBe(before.swap[2]);

      const result = await fx.sweep();

      // Three different sets of bytes, each still what it was, none shared.
      expect(await digestsOf(swap)).toEqual(before.swap);
      expect(await distinctBlocks(swap)).toBe(3);
      // Checked out with CRLF: longer than the blob, so left alone as well.
      expect(await digestsOf(crlf)).toEqual(before.crlf);
      expect(before.crlf[0]).not.toBe(before.crlf[1]);
      expect(await distinctBlocks(crlf)).toBe(3);
      // A plain LF text file is its blob, byte for byte, and is shared.
      expect(await distinctBlocks(copiesOf(fx, "plain.txt"))).toBe(1);
      expect(await distinctBlocks(copiesOf(fx, "big.bin"))).toBe(1);
      expect(result.warnings).toEqual([
        "4 file(s) left alone as normalized or filtered: a filter, ident or working-tree-encoding attribute, or a file that is not as long as its blob, means equal blobs do not prove equal files",
      ]);
      expect(actionFor(result, fx.b)?.candidate.metadata).toMatchObject({
        normalizedOrFilteredFiles: 2,
      });
      for (const wt of [fx.main, fx.a, fx.b]) {
        expect(
          await git(wt, "status", "--porcelain", "--untracked-files=no"),
        ).not.toMatch(/swap\.txt|crlf\.txt|plain\.txt/u);
      }
    },
    REAL_GIT_TIMEOUT_MS,
  );
});

describe.skipIf(!onApfs)("sweepDedupe and files that are not plain", () => {
  it(
    "leaves alone a file that is hard-linked, flagged, tagged or open, and keeps a file's own mode",
    async () => {
      const fx = await buildFixture();
      const at = (name: string) => path.join(fx.b, name);
      const hardLink = path.join(fx.root, "hard-link");
      await link(at("big.bin"), hardLink);
      system("/usr/bin/xattr", "-w", "com.example.note", "keep", at("tool.sh"));
      system("/usr/bin/chflags", "hidden", at("grown.bin"));
      await chmod(at("sub/dir/nested.bin"), 0o600);
      const held = await open(at("modified.bin"), "r+");
      const before = await inodes(fx.b, [
        ...SHARED,
        "modified.bin",
        "grown.bin",
      ]);

      const result = await fx.sweep();
      await held.close();

      expect(actionFor(result, fx.b)?.candidate.metadata).toMatchObject({
        replacedFiles: 1,
        protectedFiles: 4,
      });
      expect(result.warnings).toEqual([
        "4 file(s) left alone as in use or not plain: open in a process, hard-linked elsewhere, another user's, or carrying file flags or extended attributes",
      ]);
      const after = await inodes(fx.b, [
        ...SHARED,
        "modified.bin",
        "grown.bin",
      ]);
      for (const name of ["big.bin", "tool.sh", "modified.bin", "grown.bin"]) {
        expect(after[name]).toBe(before[name]);
      }
      // Each still has what made it special.
      const linked = await inodes(fx.root, ["hard-link"]);
      expect(linked["hard-link"]).toBe(after["big.bin"]);
      expect(system("/usr/bin/xattr", at("tool.sh"))).toContain(
        "com.example.note",
      );
      expect(system("/usr/bin/stat", "-f", "%f", at("grown.bin"))).not.toBe(
        "0",
      );
      // A private mode is no obstacle, and survives the replacement.
      expect(after["sub/dir/nested.bin"]).not.toBe(
        before["sub/dir/nested.bin"],
      );
      const nested = await lstat(at("sub/dir/nested.bin"));
      expect(nested.mode & 0o777).toBe(0o600);
      // The other worktree is unaffected.
      expect(actionFor(result, fx.a)?.candidate.metadata).toMatchObject({
        replacedFiles: 3,
        protectedFiles: 0,
      });
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "does not spread a source file's extended attributes, and shares the other copies with each other",
    async () => {
      const fx = await buildFixture();
      system(
        "/usr/bin/xattr",
        "-w",
        "com.apple.quarantine",
        "0081;00000000;Browser;",
        path.join(fx.main, "big.bin"),
      );

      const result = await fx.sweep();

      const [main, a, b] = await physicalOffsets(copiesOf(fx, "big.bin"));
      expect(a).toBe(b);
      expect(main).not.toBe(a);
      for (const wt of [fx.a, fx.b]) {
        expect(
          system("/usr/bin/xattr", path.join(wt, "big.bin")),
        ).not.toContain("quarantine");
      }
      expect(result.warnings).toEqual([
        "1 file(s) left alone as in use or not plain: open in a process, hard-linked elsewhere, another user's, or carrying file flags or extended attributes",
      ]);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "does not follow a symlink that has taken a tracked directory's place",
    async () => {
      const fx = await buildFixture();
      const moved = path.join(fx.root, "moved-dir");
      await rename(path.join(fx.a, "sub", "dir"), moved);
      await symlink(moved, path.join(fx.a, "sub", "dir"));
      const before = await inodes(moved, ["nested.bin"]);

      const result = await fx.sweep();

      expect(await inodes(moved, ["nested.bin"])).toEqual(before);
      const linked = await lstat(path.join(fx.a, "sub", "dir"));
      expect(linked.isSymbolicLink()).toBe(true);
      expect(actionFor(result, fx.a)?.candidate.metadata).toMatchObject({
        replacedFiles: 2,
      });
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "does not put a clone in place that is not the target's equal",
    async () => {
      const fx = await buildFixture();
      const before = await inodes(fx.b, SHARED);
      const result = await fx.sweep({
        cloneFile: wrongSizeForBigBin,
        worktree: fx.b,
      });

      expect(actionFor(result, fx.b)?.candidate.metadata).toMatchObject({
        files: 4,
        replacedFiles: 4,
        protectedFiles: 1,
      });
      const after = await inodes(fx.b, SHARED);
      expect(after["big.bin"]).toBe(before["big.bin"]);
      expect(await git(fx.b, "status", "--porcelain")).toBe("?? untracked.bin");
    },
    REAL_GIT_TIMEOUT_MS,
  );
});

describe.skipIf(!onApfs)(
  "sweepDedupe and per-worktree git configuration",
  () => {
    it(
      "skips a worktree whose configuration keeps git status from noticing edits",
      async () => {
        const fx = await buildFixture();
        await git(fx.main, "config", "extensions.worktreeConfig", "true");
        // Any spelling git reads as false counts, not only the word.
        await git(fx.a, "config", "--worktree", "core.trustctime", "no");
        const before = await inodes(fx.a, SHARED);

        const result = await fx.sweep();

        expect(result.warnings).toEqual([
          `Skipped ${fx.a}: core.trustctime is false, so git status cannot vouch for its files`,
        ]);
        expect(await inodes(fx.a, SHARED)).toEqual(before);
        expect(actionFor(result, fx.a)).toBeUndefined();
        expect(actionFor(result, fx.b)?.candidate.metadata).toMatchObject({
          replacedFiles: 5,
        });
      },
      REAL_GIT_TIMEOUT_MS,
    );
  },
);

describe("dedupe metadata parsing", () => {
  it("picks out files with extended attributes of their own", () => {
    const batch = ["one.txt", "two: x.txt", "three.txt", "-dash.txt"];
    const output = [
      "one.txt: com.apple.provenance",
      "two: x.txt: com.apple.provenance",
      "two: x.txt: com.apple.quarantine",
      "-dash.txt: com.apple.FinderInfo",
      "",
    ].join("\n");
    expect([...parseXattrPaths(output, batch)].sort()).toEqual([
      "-dash.txt",
      "two: x.txt",
    ]);
    // A single file is listed without its name.
    expect(parseXattrPaths("com.apple.provenance\n", ["one.txt"]).size).toBe(0);
    expect([...parseXattrPaths("user.note\n", ["one.txt"])]).toEqual([
      "one.txt",
    ]);
    // Output that fits no path is not understood: nothing is cleared.
    expect(parseXattrPaths("who knows\n", batch).size).toBe(batch.length);
  });

  it("reads the regular files processes have open from lsof", () => {
    const output = [
      "p101",
      "fcwd",
      "tDIR",
      "n/Users/me/wt",
      "f12",
      "tREG",
      "n/Users/me/wt/data.db",
      "ftxt",
      "tREG",
      "n/usr/lib/dyld",
      "f13",
      "tPIPE",
      "n->0xabc",
      "",
    ].join("\n");
    expect([...parseOpenFiles(output)]).toEqual([
      "/Users/me/wt/data.db",
      "/usr/lib/dyld",
    ]);
  });
});

describe("git settings under which status cannot vouch for files", () => {
  it(
    "reads booleans as git does, in every spelling, per worktree",
    async () => {
      const fx = await buildFixture();
      await git(fx.main, "config", "extensions.worktreeConfig", "true");
      const set = (key: string, value: string) =>
        git(fx.a, "config", "--worktree", key, value);
      const unset = (key: string) =>
        git(fx.a, "config", "--worktree", "--unset-all", key);
      expect(await trustProblem(fx.a)).toBeNull();

      for (const value of ["0", "no", "off", "false", "False", "OFF"]) {
        await set("core.trustctime", value);
        expect(await trustProblem(fx.a), value).toBe(
          "core.trustctime is false, so git status cannot vouch for its files",
        );
        // The setting is this worktree's own; the others keep the default.
        expect(await trustProblem(fx.b), value).toBeNull();
      }
      for (const value of ["1", "yes", "on", "true", "TRUE"]) {
        await set("core.trustctime", value);
        expect(await trustProblem(fx.a), value).toBeNull();
      }
      await unset("core.trustctime");

      for (const value of ["1", "yes", "on", "true"]) {
        await set("core.ignoreStat", value);
        expect(await trustProblem(fx.a), value).toBe(
          "core.ignoreStat is true, so git status cannot vouch for its files",
        );
      }
      for (const value of ["0", "no", "off", "false"]) {
        await set("core.ignoreStat", value);
        expect(await trustProblem(fx.a), value).toBeNull();
      }
      await unset("core.ignoreStat");

      // Not a boolean: `default` or `minimal`, in any case.
      for (const value of ["minimal", "MINIMAL"]) {
        await set("core.checkStat", value);
        expect(await trustProblem(fx.a), value).toContain(
          "core.checkStat is minimal",
        );
      }
      await set("core.checkStat", "default");
      expect(await trustProblem(fx.a)).toBeNull();
      await unset("core.checkStat");
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "goes by the value in effect, and keeps a worktree it cannot read",
    async () => {
      const fx = await buildFixture();
      await git(fx.main, "config", "extensions.worktreeConfig", "true");
      // Off for the repository, back on for one worktree.
      await git(fx.main, "config", "core.trustctime", "off");
      await git(fx.a, "config", "--worktree", "core.trustctime", "on");
      expect(await trustProblem(fx.a)).toBeNull();
      expect(await trustProblem(fx.b)).toContain("core.trustctime is false");
      expect(await trustProblem(fx.main)).toContain("core.trustctime is false");

      await git(fx.a, "config", "--worktree", "core.trustctime", "sometimes");
      expect(await trustProblem(fx.a)).toBe(
        "its git configuration could not be read",
      );
    },
    REAL_GIT_TIMEOUT_MS,
  );
});
