import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_INSTANCE,
  findRepoRoot,
  instanceDirectory,
  instanceOwner,
  resolveInstance,
  worktreeInstance,
} from "#protocol/instance.ts";

function runGit(cwd: string, args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "ignore",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr.toString()}`,
    );
  }
}

describe("isolated harness instances", () => {
  it("keeps the default directory for an absent, empty, or explicit default bootstrap setting", () => {
    expect(instanceDirectory("/private/mc", undefined)).toBe("/private/mc");
    expect(instanceDirectory("/private/mc", "")).toBe("/private/mc");
    expect(instanceDirectory("/private/mc", DEFAULT_INSTANCE)).toBe(
      "/private/mc",
    );
    expect(instanceOwner("user@host", DEFAULT_INSTANCE)).toBe("user@host");
  });

  it("derives deterministic disjoint wt-<slug>-<sha256_6> instances per worktree", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "mc-instance-wt-"));
    try {
      const worktreeA = path.join(tempRoot, "Worktree_Alpha_Very_Long_Feature");
      const worktreeB = path.join(tempRoot, "worktree-beta");
      const symlinkToA = path.join(tempRoot, "alias-alpha");
      const outsideRepo = path.join(
        "/tmp",
        `mc-no-git-${Date.now().toString()}`,
      );
      await mkdir(worktreeA, { recursive: true });
      runGit(worktreeA, ["init", "-q"]);
      runGit(worktreeA, ["config", "user.email", "test@example.com"]);
      runGit(worktreeA, ["config", "user.name", "Test"]);
      runGit(worktreeA, ["commit", "--allow-empty", "-q", "-m", "init"]);
      runGit(worktreeA, ["worktree", "add", "-q", "-b", "wt-beta", worktreeB]);
      await mkdir(path.join(worktreeA, "packages", "mc-harness"), {
        recursive: true,
      });
      await mkdir(outsideRepo, { recursive: true });
      await symlink(worktreeA, symlinkToA);

      try {
        const canonicalA = await realpath(worktreeA);
        expect(
          findRepoRoot(path.join(worktreeA, "packages", "mc-harness")),
        ).toBe(canonicalA);
        expect(findRepoRoot(symlinkToA)).toBe(canonicalA);
        expect(findRepoRoot(outsideRepo)).toBeNull();

        const instanceA = resolveInstance({
          cwd: path.join(worktreeA, "packages", "mc-harness"),
        });
        const instanceFromSymlink = resolveInstance({ cwd: symlinkToA });
        const instanceB = resolveInstance({ cwd: worktreeB });

        expect(instanceA).toBe(worktreeInstance(canonicalA));
        expect(instanceA).toBe(instanceFromSymlink);
        expect(instanceA).toMatch(/^wt-[a-z0-9-]+-[0-9a-f]{6}$/u);
        expect(instanceA.length).toBeLessThanOrEqual(32);
        expect(instanceB).toMatch(/^wt-worktree-beta-[0-9a-f]{6}$/u);
        expect(instanceA).not.toBe(instanceB);

        expect(
          resolveInstance({ instanceEnv: "default", cwd: worktreeA }),
        ).toBe("default");
        expect(
          resolveInstance({
            directoryEnv: "/private/mc/suite-harness",
            cwd: worktreeA,
          }),
        ).toBe("default");
        expect(resolveInstance({ cwd: outsideRepo })).toBe("default");
      } finally {
        await rm(outsideRepo, { recursive: true, force: true });
      }
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("gives concurrent tasks disjoint state without changing the shared root", () => {
    const first = instanceDirectory("/private/mc", "skylands");
    const second = instanceDirectory("/private/mc", "other-task");
    expect(first).toBe(path.join("/private/mc", "instances", "skylands"));
    expect(second).not.toBe(first);
    expect(instanceDirectory("/private/mc", undefined)).toBe("/private/mc");
    expect(instanceOwner("user@host", undefined)).toBe("user@host");
    expect(instanceOwner("user@host", "skylands")).toBe("user@host:skylands");
    expect(instanceOwner("user@host", "skylands")).not.toBe(
      instanceOwner("user@host", "other-task"),
    );
  });

  it.each([
    "../other",
    "/tmp/other",
    "a/b",
    String.raw`a\b`,
    " a",
    "Uppercase",
    "a".repeat(33),
    null,
    3,
  ])("rejects invalid instance names: %s", (name) => {
    expect(() => instanceDirectory("/private/mc", name)).toThrow();
  });
});
