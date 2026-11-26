import { mkdir, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultCommandRunner } from "#lib/tend/process-probe.ts";
import type { CommandRunner } from "#lib/tend/types.ts";
import { sweepWorktrees } from "#lib/tend/worktrees.ts";
import { directoryExists } from "#lib/tend/worktrees-git.ts";
import {
  rescueRefName,
  snapshotDirtyWorktree,
} from "#lib/tend/worktrees-rescue.ts";
import { makeLiveness } from "./worktree-fixtures.ts";

const REAL_GIT_TIMEOUT_MS = 60_000;
const DAY_MS = 86_400_000;

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
  argv[0] === "hc"
    ? // Herdr is not part of this test: no terminals are open anywhere.
      Promise.resolve({ exitCode: 0, stdout: '{"terminals":[]}', stderr: "" })
    : defaultCommandRunner(argv, {
        ...options,
        env: { ...GIT_ENV, ...options.env },
      });

async function git(cwd: string, ...args: string[]): Promise<string> {
  const res = await runner(["git", ...args], { cwd });
  if (res.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  }
  return res.stdout.trim();
}

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function write(dir: string, name: string, text: string): Promise<void> {
  await Bun.write(path.join(dir, name), text);
}

/** A repository at `<root>/git/proj` with `origin/main`, plus `<root>/wts`. */
async function initRepository(): Promise<{
  readonly root: string;
  readonly repo: string;
  readonly worktreesDir: string;
}> {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "tend-rescue-test-")),
  );
  tempDirs.push(root);
  const repo = path.join(root, "git", "proj");
  const origin = path.join(root, "origin.git");
  const worktreesDir = path.join(root, "wts");
  await mkdir(repo, { recursive: true });
  await mkdir(worktreesDir, { recursive: true });
  await git(root, "init", "-q", "--bare", "-b", "main", origin);
  await git(repo, "init", "-q", "-b", "main");
  await write(repo, ".gitignore", "ignored.log\nbuild/\n");
  await write(repo, "tracked.txt", "v1\n");
  await write(repo, "removed.txt", "going away\n");
  await git(repo, "add", "-A");
  await git(repo, "commit", "-q", "-m", "initial");
  await git(repo, "remote", "add", "origin", origin);
  await git(repo, "push", "-q", "origin", "main");
  return { root, repo, worktreesDir };
}

async function makeDirty(wt: string): Promise<void> {
  await write(wt, "tracked.txt", "v2\n");
  await write(wt, "untracked.txt", "new work\n");
  await write(wt, "nested/deep/file.txt", "deep work\n");
  await write(wt, "staged.txt", "staged work\n");
  await git(wt, "add", "staged.txt");
  await write(wt, "ignored.log", "noise\n");
  await write(wt, "build/out.js", "noise\n");
  await rm(path.join(wt, "removed.txt"));
}

describe("rescueRefName", () => {
  it("is the worktree basename plus a UTC timestamp, safe as a ref name", () => {
    const nowMs = Date.UTC(2026, 10, 25, 9, 8, 7);
    expect(rescueRefName("/a/b/agent-1f2e", nowMs)).toBe(
      "refs/tend/rescue/agent-1f2e-20261125T090807Z",
    );
    expect(rescueRefName("/a/b/my wt..x.lock", nowMs)).toBe(
      "refs/tend/rescue/my-wt-x-lock-20261125T090807Z",
    );
    expect(rescueRefName("/", nowMs)).toBe(
      "refs/tend/rescue/worktree-20261125T090807Z",
    );
  });
});

describe("snapshotDirtyWorktree with real git", () => {
  it(
    "commits modified, staged, deleted and untracked files, honors .gitignore, and leaves the worktree's index alone",
    async () => {
      const { repo, worktreesDir } = await initRepository();
      const wt = path.join(worktreesDir, "feature");
      await git(repo, "worktree", "add", "-q", "-b", "feat", wt);
      await makeDirty(wt);
      const gitDir = await git(wt, "rev-parse", "--absolute-git-dir");
      const indexPath = path.join(gitDir, "index");
      // Plain `git status` refreshes the index, so read it first.
      const statusBefore = await git(wt, "status", "--porcelain");
      const indexBefore = await Bun.file(indexPath).bytes();
      const indexStatBefore = await stat(indexPath);
      const nowMs = Date.UTC(2026, 10, 25, 9, 8, 7);
      const ref = rescueRefName(wt, nowMs);

      const result = await snapshotDirtyWorktree({
        wtPath: wt,
        gitDir,
        ref,
        runner,
        nowMs,
      });

      expect(result).toMatchObject({ ok: true, ref });
      expect(ref).toBe("refs/tend/rescue/feature-20261125T090807Z");
      const files = await git(repo, "ls-tree", "-r", "--name-only", ref);
      expect(files.split("\n").sort()).toEqual([
        ".gitignore",
        "nested/deep/file.txt",
        "staged.txt",
        "tracked.txt",
        "untracked.txt",
      ]);
      expect(await git(repo, "show", `${ref}:tracked.txt`)).toBe("v2");
      expect(await git(repo, "show", `${ref}:untracked.txt`)).toBe("new work");
      expect(await git(repo, "rev-parse", `${ref}^`)).toBe(
        await git(wt, "rev-parse", "HEAD"),
      );
      expect(await git(repo, "log", "-1", "--format=%an <%ae>", ref)).toBe(
        "toolkit tend <toolkit-tend@localhost>",
      );

      // The real index is byte-identical and was not rewritten.
      expect(await Bun.file(indexPath).bytes()).toEqual(indexBefore);
      const indexStatAfter = await stat(indexPath);
      expect(indexStatAfter.mtimeMs).toBe(indexStatBefore.mtimeMs);
      expect(await git(wt, "status", "--porcelain")).toBe(statusBefore);
      expect(statusBefore).toContain("?? untracked.txt");

      // The snapshot restores into a new worktree.
      const restored = path.join(worktreesDir, "restored");
      await git(repo, "worktree", "add", "-q", "--detach", restored, ref);
      expect(
        await Bun.file(path.join(restored, "nested/deep/file.txt")).text(),
      ).toBe("deep work\n");
      expect(await Bun.file(path.join(restored, "removed.txt")).exists()).toBe(
        false,
      );

      // A rescue ref is never overwritten.
      const again = await snapshotDirtyWorktree({
        wtPath: wt,
        gitDir,
        ref,
        runner,
        nowMs,
      });
      expect(again).toMatchObject({ ok: false });
      expect(again.ok ? "" : again.detail).toContain("git update-ref");
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "refuses to snapshot an untracked nested repository it cannot preserve",
    async () => {
      const { repo, worktreesDir } = await initRepository();
      const wt = path.join(worktreesDir, "nested-repo");
      await git(repo, "worktree", "add", "-q", "-b", "feat", wt);
      const inner = path.join(wt, "vendor", "inner");
      await mkdir(inner, { recursive: true });
      await git(inner, "init", "-q", "-b", "main");
      await write(inner, "inner.txt", "inner work\n");
      await git(inner, "add", "-A");
      await git(inner, "commit", "-q", "-m", "inner");

      const result = await snapshotDirtyWorktree({
        wtPath: wt,
        gitDir: await git(wt, "rev-parse", "--absolute-git-dir"),
        ref: rescueRefName(wt, Date.now()),
        runner,
        nowMs: Date.now(),
      });

      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.detail).toContain(
        "embedded git repository at vendor/inner",
      );
      expect(await git(repo, "for-each-ref", "refs/tend/rescue")).toBe("");
    },
    REAL_GIT_TIMEOUT_MS,
  );
});

describe("sweepWorktrees --apply with real git", () => {
  it(
    "removes idle worktrees, saves their work under refs/tend/rescue, and keeps unmerged branches",
    async () => {
      const { root, repo, worktreesDir } = await initRepository();
      const at = (name: string) => path.join(worktreesDir, name);

      await git(repo, "worktree", "add", "-q", "-b", "feat/dirty", at("dirty"));
      await write(at("dirty"), "committed.txt", "unmerged commit\n");
      await git(at("dirty"), "add", "-A");
      await git(at("dirty"), "commit", "-q", "-m", "unmerged");
      await makeDirty(at("dirty"));

      await git(repo, "worktree", "add", "-q", "--detach", at("detached"));
      await write(at("detached"), "experiment.txt", "detached commit\n");
      await git(at("detached"), "add", "-A");
      await git(at("detached"), "commit", "-q", "-m", "experiment");
      const detachedHead = await git(at("detached"), "rev-parse", "HEAD");

      await git(
        repo,
        "worktree",
        "add",
        "-q",
        "-b",
        "feat/merged",
        at("merged"),
      );
      await git(repo, "worktree", "add", "-q", "-b", "feat/held", at("held"));

      const result = await sweepWorktrees({
        liveness: makeLiveness({
          platform: process.platform,
          protectedPaths: new Set([path.join(at("held"), "src")]),
        }),
        runner,
        apply: true,
        gitDirs: [path.join(root, "git")],
        homeDir: root,
        selfCwd: root,
        checkPullRequests: false,
        nowMs: Date.now() + 10 * DAY_MS,
      });

      expect(result.warnings).toEqual([]);
      const actionFor = (name: string) =>
        result.actions.find((action) => action.candidate.target === at(name));
      expect(result.actions).toHaveLength(3);
      for (const name of ["dirty", "detached", "merged"]) {
        expect(actionFor(name)?.status).toBe("removed");
      }
      expect(
        result.decisions
          ?.filter((decision) => decision.action === "keep")
          .map((decision) => [decision.target, decision.category]),
      ).toEqual([[at("held"), "protected path"]]);
      for (const name of ["dirty", "detached", "merged"]) {
        expect(await directoryExists(at(name))).toBe(false);
      }
      expect(await directoryExists(at("held"))).toBe(true);

      const refList = await git(
        repo,
        "for-each-ref",
        "--format=%(refname)",
        "refs/tend/rescue",
      );
      const refs = refList.split("\n");
      expect(refs).toHaveLength(2);
      const dirtyRef = refs.find((ref) => ref.includes("/dirty-")) ?? "";
      const detachedRef = refs.find((ref) => ref.includes("/detached-")) ?? "";
      expect(actionFor("dirty")?.detail).toBe(
        `work saved to ${dirtyRef}; branch feat/dirty kept`,
      );
      expect(actionFor("detached")?.detail).toBe(
        `work saved to ${detachedRef}`,
      );
      expect(actionFor("merged")?.detail).toBeUndefined();

      // Uncommitted work, the unmerged commit under it, and the branch survive.
      expect(await git(repo, "show", `${dirtyRef}:untracked.txt`)).toBe(
        "new work",
      );
      expect(await git(repo, "show", `${dirtyRef}:committed.txt`)).toBe(
        "unmerged commit",
      );
      expect(await git(repo, "rev-parse", `${dirtyRef}^`)).toBe(
        await git(repo, "rev-parse", "feat/dirty"),
      );
      expect(await git(repo, "rev-parse", detachedRef)).toBe(detachedHead);

      const branchList = await git(repo, "branch", "--format=%(refname:short)");
      const branches = branchList.split("\n");
      expect(branches.sort()).toEqual(["feat/dirty", "feat/held", "main"]);
    },
    REAL_GIT_TIMEOUT_MS,
  );
});
