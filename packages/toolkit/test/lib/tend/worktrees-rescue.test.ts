import { mkdir, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CommandRunner } from "#lib/tend/types.ts";
import { sweepWorktrees } from "#lib/tend/worktrees.ts";
import { directoryExists } from "#lib/tend/worktrees-git.ts";
import {
  rescueRefName,
  snapshotDirtyWorktree,
} from "#lib/tend/worktrees-rescue.ts";
import { readWorktreeStatus } from "#lib/tend/worktrees-status.ts";
import { gitThrough, REAL_GIT_TIMEOUT_MS, realGitRunner } from "./real-git.ts";
import { makeLiveness } from "./worktree-fixtures.ts";

const DAY_MS = 86_400_000;
const runner = realGitRunner();
const git = gitThrough(runner);

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
  await write(repo, "second.txt", "v1\n");
  await write(repo, "unstaged-later.txt", "v1\n");
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
  // Staged and working states that differ, each the only copy of something.
  await write(wt, "partial.txt", "staged version\n");
  await git(wt, "add", "partial.txt");
  await write(wt, "partial.txt", "working version\n");
  await write(wt, "second.txt", "staged only\n");
  await git(wt, "add", "second.txt");
  await write(wt, "second.txt", "v1\n");
  await write(wt, "staged-addition.txt", "added, then deleted on disk\n");
  await git(wt, "add", "staged-addition.txt");
  await rm(path.join(wt, "staged-addition.txt"));
  await git(wt, "rm", "-q", "--cached", "unstaged-later.txt");
}

async function treeFiles(repo: string, commit: string): Promise<string[]> {
  const files = await git(repo, "ls-tree", "-r", "--name-only", commit);
  return files.split("\n").sort();
}

/** The fixture runner, with something happening after chosen commands. */
function runnerWith(
  after: (argv: readonly string[], cwd: string) => Promise<void>,
): CommandRunner {
  return async (argv, options = {}) => {
    const result = await runner(argv, options);
    await after(argv, options.cwd ?? "");
    return result;
  };
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
    "saves the staged state and the working tree as two commits, honors .gitignore, and leaves the worktree's index alone",
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

      const head = await git(wt, "rev-parse", "HEAD");
      const result = await snapshotDirtyWorktree({
        wtPath: wt,
        gitDir,
        head,
        ref,
        runner,
        nowMs,
      });

      expect(result).toMatchObject({ ok: true, ref });
      expect(ref).toBe("refs/tend/rescue/feature-20261125T090807Z");
      // HEAD <- staged changes <- working tree (the ref).
      expect(await git(repo, "rev-parse", `${ref}^^`)).toBe(head);
      expect(await git(repo, "rev-list", "--count", `${head}..${ref}`)).toBe(
        "2",
      );

      // The working tree: everything on disk that is not ignored.
      expect(await treeFiles(repo, ref)).toEqual([
        ".gitignore",
        "nested/deep/file.txt",
        "partial.txt",
        "second.txt",
        "staged.txt",
        "tracked.txt",
        "unstaged-later.txt",
        "untracked.txt",
      ]);
      expect(await git(repo, "show", `${ref}:tracked.txt`)).toBe("v2");
      expect(await git(repo, "show", `${ref}:untracked.txt`)).toBe("new work");
      expect(await git(repo, "show", `${ref}:partial.txt`)).toBe(
        "working version",
      );
      expect(await git(repo, "show", `${ref}:second.txt`)).toBe("v1");

      // The staged state: what the index held, including the versions the
      // working tree no longer has.
      expect(await treeFiles(repo, `${ref}^`)).toEqual([
        ".gitignore",
        "partial.txt",
        "removed.txt",
        "second.txt",
        "staged-addition.txt",
        "staged.txt",
        "tracked.txt",
      ]);
      expect(await git(repo, "show", `${ref}^:partial.txt`)).toBe(
        "staged version",
      );
      expect(await git(repo, "show", `${ref}^:second.txt`)).toBe("staged only");
      expect(await git(repo, "show", `${ref}^:staged-addition.txt`)).toBe(
        "added, then deleted on disk",
      );
      expect(await git(repo, "show", `${ref}^:tracked.txt`)).toBe("v1");
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
        head,
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
        head: await git(wt, "rev-parse", "HEAD"),
        ref: rescueRefName(wt, Date.now()),
        runner,
        nowMs: Date.now(),
      });

      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.detail).toContain(
        "contains a submodule or nested git repository at vendor/inner",
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
      expect(await git(repo, "rev-parse", `${dirtyRef}^^`)).toBe(
        await git(repo, "rev-parse", "feat/dirty"),
      );
      expect(await git(repo, "show", `${dirtyRef}^:partial.txt`)).toBe(
        "staged version",
      );
      expect(await git(repo, "rev-parse", detachedRef)).toBe(detachedHead);

      const branchList = await git(repo, "branch", "--format=%(refname:short)");
      const branches = branchList.split("\n");
      expect(branches.sort()).toEqual(["feat/dirty", "feat/held", "main"]);
    },
    REAL_GIT_TIMEOUT_MS,
  );
});

type SweepFixture = {
  readonly root: string;
  readonly repo: string;
  readonly at: (name: string) => string;
  /** An applied sweep in which every worktree counts as idle. */
  readonly sweep: (
    sweepRunner?: CommandRunner,
    checkPullRequests?: boolean,
  ) => ReturnType<typeof sweepWorktrees>;
};

async function sweepFixture(): Promise<SweepFixture> {
  const { root, repo, worktreesDir } = await initRepository();
  return {
    root,
    repo,
    at: (name) => path.join(worktreesDir, name),
    sweep: (sweepRunner = runner, checkPullRequests = false) =>
      sweepWorktrees({
        liveness: makeLiveness({ platform: process.platform }),
        runner: sweepRunner,
        apply: true,
        gitDirs: [path.join(root, "git")],
        homeDir: root,
        selfCwd: root,
        checkPullRequests,
        nowMs: Date.now() + 10 * DAY_MS,
      }),
  };
}

async function rescueRefs(repo: string): Promise<string[]> {
  const refs = await git(
    repo,
    "for-each-ref",
    "--format=%(refname)",
    "refs/tend/rescue",
  );
  return refs.length === 0 ? [] : refs.split("\n");
}

describe("readWorktreeStatus with real git", () => {
  it(
    "names untracked files, not only the directory that holds them",
    async () => {
      const { repo, worktreesDir } = await initRepository();
      const wt = path.join(worktreesDir, "scratch");
      await git(repo, "worktree", "add", "-q", "-b", "feat", wt);
      await write(wt, "scratch/deep/draft.txt", "notes\n");
      await write(wt, "scratch/other.txt", "notes\n");
      // Even when the user's configuration hides untracked files.
      await git(wt, "config", "status.showUntrackedFiles", "no");

      const status = await readWorktreeStatus(wt, runner, "all");

      expect(status).toEqual({
        kind: "dirty",
        paths: ["scratch/deep/draft.txt", "scratch/other.txt"],
      });

      // A caller that only cares about tracked files skips the walk.
      await write(wt, "tracked.txt", "edited\n");
      expect(await readWorktreeStatus(wt, runner, "no")).toEqual({
        kind: "dirty",
        paths: ["tracked.txt"],
      });
    },
    REAL_GIT_TIMEOUT_MS,
  );
});

describe("sweepWorktrees and submodules with real git", () => {
  it(
    "keeps a worktree whose submodule has uncommitted work, and never snapshots it",
    async () => {
      const fx = await sweepFixture();
      const library = path.join(fx.root, "library");
      await mkdir(library);
      await git(library, "init", "-q", "-b", "main");
      await write(library, "lib.txt", "v1\n");
      await git(library, "add", "-A");
      await git(library, "commit", "-q", "-m", "library");
      const allowFile = ["-c", "protocol.file.allow=always"];
      await git(
        fx.repo,
        ...allowFile,
        "submodule",
        "add",
        "-q",
        library,
        "deps/lib",
      );
      await git(fx.repo, "commit", "-q", "-m", "add submodule");
      await git(fx.repo, "push", "-q", "origin", "main");

      const wt = fx.at("with-submodule");
      await git(fx.repo, "worktree", "add", "-q", "-b", "feat/sub", wt);
      await git(wt, ...allowFile, "submodule", "update", "-q", "--init");
      // Uncommitted work inside the submodule; its HEAD has not moved.
      await write(wt, "deps/lib/lib.txt", "edited in the submodule\n");
      await write(wt, "deps/lib/new.txt", "untracked in the submodule\n");
      expect(await git(wt, "diff", "--cached", "--raw", "HEAD")).toBe("");

      // A snapshot would hold the gitlink and none of those files.
      const snapshot = await snapshotDirtyWorktree({
        wtPath: wt,
        gitDir: await git(wt, "rev-parse", "--absolute-git-dir"),
        head: await git(wt, "rev-parse", "HEAD"),
        ref: rescueRefName(wt, Date.now()),
        runner,
        nowMs: Date.now(),
      });
      expect(snapshot.ok ? "" : snapshot.detail).toBe(
        "contains a submodule or nested git repository at deps/lib, whose files a snapshot cannot save",
      );

      const result = await fx.sweep();

      expect(result.actions).toEqual([]);
      expect(result.decisions).toEqual([
        expect.objectContaining({
          target: wt,
          action: "keep",
          category: "contains a submodule",
        }),
      ]);
      expect(await Bun.file(path.join(wt, "deps/lib/lib.txt")).text()).toBe(
        "edited in the submodule\n",
      );
      expect(await Bun.file(path.join(wt, "deps/lib/new.txt")).exists()).toBe(
        true,
      );
      expect(await rescueRefs(fx.repo)).toEqual([]);
    },
    REAL_GIT_TIMEOUT_MS,
  );
});

describe("sweepWorktrees and changes during the sweep, with real git", () => {
  it(
    "does not remove a dirty worktree that is edited after its snapshot",
    async () => {
      const fx = await sweepFixture();
      const wt = fx.at("dirty");
      await git(fx.repo, "worktree", "add", "-q", "-b", "feat/dirty", wt);
      await makeDirty(wt);
      let saved = false;
      // An editor saves a file the moment the rescue ref has been written.
      const editing = runnerWith(async (argv, cwd) => {
        if (!saved && cwd === wt && argv.includes("update-ref")) {
          saved = true;
          await write(wt, "tracked.txt", "v3, saved after the snapshot\n");
        }
      });

      const result = await fx.sweep(editing);

      expect(saved).toBe(true);
      const [ref = ""] = await rescueRefs(fx.repo);
      expect(result.actions).toEqual([
        expect.objectContaining({
          status: "skipped",
          detail: `changed during the sweep: files changed after they were saved; work saved to ${ref}`,
        }),
      ]);
      expect(result.decisions?.[0]).toMatchObject({
        action: "keep",
        category: "changed during the sweep",
      });
      // The worktree is intact with the late edit, which the ref lacks.
      expect(await Bun.file(path.join(wt, "tracked.txt")).text()).toBe(
        "v3, saved after the snapshot\n",
      );
      expect(await git(fx.repo, "show", `${ref}:tracked.txt`)).toBe("v2");
      expect(await git(wt, "status", "--porcelain")).toContain("tracked.txt");
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "does not remove a detached worktree that gains a commit after it was listed",
    async () => {
      const fx = await sweepFixture();
      const wt = fx.at("detached");
      await git(fx.repo, "worktree", "add", "-q", "--detach", wt);
      const listedHead = await git(wt, "rev-parse", "HEAD");
      let committed = false;
      // Someone commits right after the sweep has read the worktree.
      const committing = runnerWith(async (argv, cwd) => {
        if (!committed && cwd === wt && argv.includes("status")) {
          committed = true;
          await write(wt, "late.txt", "late commit\n");
          await git(wt, "add", "-A");
          await git(wt, "commit", "-q", "-m", "late");
        }
      });

      const result = await fx.sweep(committing);

      const newHead = await git(wt, "rev-parse", "HEAD");
      expect(newHead).not.toBe(listedHead);
      expect(result.actions).toEqual([
        expect.objectContaining({
          status: "skipped",
          detail: `changed during the sweep: HEAD moved from ${listedHead.slice(0, 12)} to ${newHead.slice(0, 12)}`,
        }),
      ]);
      expect(await directoryExists(wt)).toBe(true);
      // No rescue ref at the commit that was no longer HEAD.
      expect(await rescueRefs(fx.repo)).toEqual([]);
    },
    REAL_GIT_TIMEOUT_MS,
  );
});

/** `gh pr list` answering that `branch` was merged at `tip`. */
function withMergedPr(
  branch: string,
  tip: string,
  base: CommandRunner,
): CommandRunner {
  return (argv, options) => {
    if (argv[0] !== "gh") {
      return base(argv, options);
    }
    const rows = argv.includes("open")
      ? []
      : [
          {
            headRefName: branch,
            state: "MERGED",
            updatedAt: new Date().toISOString(),
            headRefOid: tip,
          },
        ];
    return Promise.resolve({
      exitCode: 0,
      stdout: JSON.stringify(rows),
      stderr: "",
    });
  };
}

async function squashedWorktree(fx: SweepFixture): Promise<string> {
  const wt = fx.at("squashed");
  await git(fx.repo, "worktree", "add", "-q", "-b", "feat/squashed", wt);
  await write(wt, "feature.txt", "squash-merged upstream\n");
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", "feature");
  await git(fx.repo, "config", "branch.feat/squashed.remote", "origin");
  return git(wt, "rev-parse", "HEAD");
}

describe("sweepWorktrees branch deletion with real git", () => {
  it(
    "deletes a merged branch and its configuration when it is still the judged commit",
    async () => {
      const fx = await sweepFixture();
      const tip = await squashedWorktree(fx);

      const result = await fx.sweep(
        withMergedPr("feat/squashed", tip, runner),
        true,
      );

      expect(result.actions).toEqual([
        expect.objectContaining({ status: "removed" }),
      ]);
      expect(result.actions[0]?.detail).toBeUndefined();
      expect(await git(fx.repo, "branch", "--list", "feat/squashed")).toBe("");
      const config = await runner(
        ["git", "config", "--get-regexp", String.raw`^branch\.feat/squashed\.`],
        { cwd: fx.repo },
      );
      expect(config.stdout).toBe("");
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "keeps a merged branch another worktree checked out before the delete",
    async () => {
      const fx = await sweepFixture();
      const tip = await squashedWorktree(fx);
      const elsewhere = path.join(fx.root, "elsewhere");
      let checkedOut = false;
      // Another session checks the branch out the moment its worktree is
      // gone. Its tip is still the judged commit, so only git's own
      // checked-out rule stands between the delete and that session.
      const checkingOut = runnerWith(async (argv) => {
        if (!checkedOut && argv.includes("remove")) {
          checkedOut = true;
          await git(
            fx.repo,
            "worktree",
            "add",
            "-q",
            elsewhere,
            "feat/squashed",
          );
        }
      });

      const result = await fx.sweep(
        withMergedPr("feat/squashed", tip, checkingOut),
        true,
      );

      expect(checkedOut).toBe(true);
      expect(result.actions[0]?.status).toBe("removed");
      expect(result.actions[0]?.detail).toBe(
        `branch feat/squashed kept (checked out in ${elsewhere})`,
      );
      expect(await git(fx.repo, "rev-parse", "feat/squashed")).toBe(tip);
      // The other checkout is still on a branch that exists.
      expect(await git(elsewhere, "rev-parse", "--abbrev-ref", "HEAD")).toBe(
        "feat/squashed",
      );
      expect(await git(elsewhere, "status", "--porcelain")).toBe("");
      expect(
        await git(fx.repo, "config", "--get", "branch.feat/squashed.remote"),
      ).toBe("origin");
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "keeps a merged branch that moved to another commit before the delete",
    async () => {
      const fx = await sweepFixture();
      const tip = await squashedWorktree(fx);
      const main = await git(fx.repo, "rev-parse", "main");
      let moved = false;
      // The branch is pointed elsewhere the moment its worktree is gone.
      const moving = runnerWith(async (argv) => {
        if (!moved && argv.includes("remove")) {
          moved = true;
          await git(fx.repo, "update-ref", "refs/heads/feat/squashed", main);
        }
      });

      const result = await fx.sweep(
        withMergedPr("feat/squashed", tip, moving),
        true,
      );

      expect(moved).toBe(true);
      expect(result.actions[0]?.status).toBe("removed");
      expect(result.actions[0]?.detail).toContain(
        "branch feat/squashed kept (",
      );
      expect(await git(fx.repo, "rev-parse", "feat/squashed")).toBe(main);
    },
    REAL_GIT_TIMEOUT_MS,
  );
});
