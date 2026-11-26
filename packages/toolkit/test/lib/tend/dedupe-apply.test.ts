import { chown, lstat, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  actionFor,
  addWorktreeUnderSystemTmp,
  buildFixture,
  digest,
  git,
  inodes,
  onApfs,
  physicalOffsets,
  removeFixtures,
  SHARED,
  stagingDir,
  system,
  userTempDir,
} from "./dedupe-fixtures.ts";
import { REAL_GIT_TIMEOUT_MS } from "./real-git.ts";

afterEach(removeFixtures);

/** Every file of a clean checkout of the fixture that is large enough. */
const DUPLICATES = [...SHARED, "modified.bin", "grown.bin"] as const;
const PROVENANCE = "com.apple.provenance";

/** What must be the same about a file before and after it is replaced. */
async function keptFacts(file: string) {
  const info = await lstat(file);
  return {
    uid: info.uid,
    gid: info.gid,
    mode: info.mode,
    size: info.size,
    mtimeMs: Math.floor(info.mtimeMs),
    content: await digest(file),
  };
}

describe.skipIf(!onApfs)(
  "sweepDedupe applied to a worktree somewhere else on the disk",
  () => {
    it(
      "shares every file the dry run planned, in a worktree whose group is not its git directory's",
      async () => {
        const fx = await buildFixture(undefined, userTempDir());
        const wt = await addWorktreeUnderSystemTmp(fx);
        const at = (name: string) => path.join(wt, name);
        const staging = await stagingDir(wt);

        // The situation: files fresh from `git worktree add`, in the group
        // of the directory they were checked out into, with the attribute
        // macOS stamps on new files, and a git directory in another group.
        const gitDirInfo = await lstat(path.dirname(staging));
        const fresh = await lstat(at("big.bin"));
        expect(fresh.gid).not.toBe(gitDirInfo.gid);
        for (const name of DUPLICATES) {
          if (!system("/usr/bin/xattr", at(name)).includes(PROVENANCE)) {
            system("/usr/bin/xattr", "-w", PROVENANCE, "", at(name));
          }
          expect(system("/usr/bin/xattr", at(name))).toBe(PROVENANCE);
        }
        // What a run that died while preparing would have left behind.
        const deadSeed = at(".tend-dedupe-2147483600");
        await mkdir(deadSeed);
        const before = {
          inodes: await inodes(wt, DUPLICATES),
          big: await keptFacts(at("big.bin")),
          tool: await keptFacts(at("tool.sh")),
          root: await lstat(wt),
        };
        for (const name of DUPLICATES) {
          const [mine, mains] = await physicalOffsets([
            at(name),
            path.join(fx.main, name),
          ]);
          expect(mine).not.toBe(mains);
        }

        const planned = await fx.sweep({ apply: false, worktree: wt });
        const applied = await fx.sweep({ worktree: wt });

        // The dry run foresaw exactly what the applied run then did.
        expect(planned.warnings).toEqual([]);
        expect(actionFor(planned, wt)).toMatchObject({
          status: "planned",
          candidate: {
            metadata: { files: 5, bytes: 660_000, protectedFiles: 0 },
          },
        });
        expect(applied.warnings).toEqual([]);
        expect(actionFor(applied, wt)).toMatchObject({
          status: "deduped",
          candidate: {
            metadata: {
              files: 5,
              bytes: 660_000,
              replacedFiles: 5,
              replacedBytes: 660_000,
              protectedFiles: 0,
            },
          },
        });
        expect(actionFor(applied, wt)?.detail).toBeUndefined();

        // Every duplicate now sits on the main checkout's blocks.
        const after = await inodes(wt, DUPLICATES);
        for (const name of DUPLICATES) {
          const [mine, mains] = await physicalOffsets([
            at(name),
            path.join(fx.main, name),
          ]);
          expect(mine).toBe(mains);
          expect(after[name]).not.toBe(before.inodes[name]);
        }
        // The files are still their worktree's: same group, owner, mode,
        // size, time and content.
        expect(await keptFacts(at("big.bin"))).toEqual(before.big);
        expect(await keptFacts(at("tool.sh"))).toEqual(before.tool);
        expect(before.big.gid).toBe(fresh.gid);

        // Nothing is left in the worktree or its git directory, and git
        // sees no change.
        expect(await git(wt, "status", "--porcelain")).toBe("");
        const names = await readdir(wt);
        expect(names.filter((name) => name.includes("tend-dedupe"))).toEqual(
          [],
        );
        expect(await readdir(path.dirname(staging))).not.toContain(
          "tend-dedupe",
        );
        const root = await lstat(wt);
        expect(root.mtimeMs).toBe(before.root.mtimeMs);
      },
      REAL_GIT_TIMEOUT_MS,
    );

    it(
      "leaves alone a file in another group than its worktree's, and says so in a dry run too",
      async () => {
        const fx = await buildFixture();
        const regrouped = path.join(fx.b, "big.bin");
        const own = await lstat(regrouped);
        const groups = process.getgroups?.() ?? [];
        const otherGroup = groups.find((group) => group !== own.gid);
        if (otherGroup === undefined) {
          throw new Error("this test needs a user who is in two groups");
        }
        await chown(regrouped, -1, otherGroup);
        const leftAlone = {
          files: 4,
          protectedFiles: 1,
          protectedOtherGroup: 1,
        };
        const warnings = [
          "1 file(s) left alone as in use or not plain: 1 in a group other than their worktree directory's",
        ];

        const planned = await fx.sweep({ apply: false, worktree: fx.b });
        const applied = await fx.sweep({ worktree: fx.b });

        expect(actionFor(planned, fx.b)?.candidate.metadata).toMatchObject(
          leftAlone,
        );
        expect(planned.warnings).toEqual(warnings);
        expect(actionFor(applied, fx.b)?.candidate.metadata).toMatchObject({
          ...leftAlone,
          replacedFiles: 4,
        });
        expect(applied.warnings).toEqual(warnings);
        const kept = await lstat(regrouped);
        expect(kept.ino).toBe(own.ino);
        expect(kept.gid).toBe(otherGroup);
      },
      REAL_GIT_TIMEOUT_MS,
    );
  },
);
