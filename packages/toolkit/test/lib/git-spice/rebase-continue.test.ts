import path from "node:path";
import { describe, expect, test } from "vitest";
import { runGitSpice } from "#lib/git-spice/run.ts";
import {
  readSpiceBranches,
  readSpiceRebaseContinue,
} from "#lib/git-spice/spice-state.ts";
import {
  registerTempDirs,
  runGitSync as git,
  seedSpiceDataRef,
} from "./spice-test-harness.ts";

const { makeTempDir, installGitSpiceShim } = registerTempDirs();

describe("rebase continue isolation across worktrees (AI-154)", () => {
  test("completes git rebase --continue and updates base.hash without touching another worktree's continuation", async () => {
    const root = await makeTempDir("toolkit-spice-ai154-");
    const shimEnv = await installGitSpiceShim(Bun.env);
    const remote = path.join(root, "remote.git");
    const mainWt = path.join(root, "main-wt");
    const wtA = path.join(root, "wt-a");
    const wtB = path.join(root, "wt-b");

    git(["init", "--bare", "-b", "main", remote], root);
    git(["clone", remote, mainWt], root);
    git(["config", "user.name", "Test"], mainWt);
    git(["config", "user.email", "test@example.com"], mainWt);
    await Bun.write(path.join(mainWt, "shared.txt"), "line 1\n");
    git(["add", "shared.txt"], mainWt);
    git(["commit", "-m", "initial"], mainWt);
    git(["push", "-u", "origin", "main"], mainWt);
    const initialMainSha = git(["rev-parse", "main"], mainWt);

    git(
      ["worktree", "add", "-b", "refactor/other-worktree", wtA, "main"],
      mainWt,
    );
    git(["worktree", "add", "-b", "feat/my-branch", wtB, "main"], mainWt);
    await Bun.write(path.join(wtB, "shared.txt"), "from my-branch\n");
    git(["add", "shared.txt"], wtB);
    git(["commit", "-m", "feat: update shared"], wtB);

    await Bun.write(path.join(mainWt, "shared.txt"), "from main v2\n");
    git(["add", "shared.txt"], mainWt);
    git(["commit", "-m", "main: conflicting update"], mainWt);
    const newMainSha = git(["rev-parse", "main"], mainWt);

    const rebaseStart = Bun.spawnSync(["git", "rebase", "main"], {
      cwd: wtB,
      env: shimEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(rebaseStart.exitCode).not.toBe(0);

    await seedSpiceDataRef(
      mainWt,
      { trunk: "main", remote: "origin" },
      {
        "refactor/other-worktree": {
          base: { name: "main", hash: initialMainSha },
        },
        "feat/my-branch": {
          base: { name: "main", hash: initialMainSha },
        },
      },
      {
        makeTempDir,
        continuations: [
          { command: ["branch", "restack"], branch: "refactor/other-worktree" },
        ],
      },
    );

    await Bun.write(path.join(wtB, "shared.txt"), "resolved content\n");
    git(["add", "shared.txt"], wtB);

    const exitCode = await runGitSpice(
      ["rbc", "--no-edit"],
      { ...shimEnv },
      { cwd: wtB, stdin: "ignore" },
    );
    expect(exitCode).toBe(0);

    expect(git(["branch", "--show-current"], wtB)).toBe("feat/my-branch");
    expect(git(["rev-parse", "HEAD~1"], wtB)).toBe(newMainSha);

    const branches = await readSpiceBranches(wtB, shimEnv);
    expect(branches.get("feat/my-branch")?.baseHash).toBe(newMainSha);

    const continuations = await readSpiceRebaseContinue(wtB, shimEnv);
    expect(continuations).toEqual([
      {
        command: ["branch", "restack"],
        branch: "refactor/other-worktree",
      },
    ]);
  });

  test("delegates to native git-spice rebase continue when continuation belongs to same stack in same worktree", async () => {
    const root = await makeTempDir("toolkit-spice-ai154-stack-");
    const shimEnv = await installGitSpiceShim(Bun.env);
    const remote = path.join(root, "remote.git");
    const repo = path.join(root, "repo");

    git(["init", "--bare", "-b", "main", remote], root);
    git(["clone", remote, repo], root);
    git(["config", "user.name", "Test"], repo);
    git(["config", "user.email", "test@example.com"], repo);
    await Bun.write(path.join(repo, "f.txt"), "base\n");
    git(["add", "f.txt"], repo);
    git(["commit", "-m", "init"], repo);
    git(["push", "-u", "origin", "main"], repo);
    const initMainSha = git(["rev-parse", "main"], repo);

    git(["checkout", "-b", "stack-1"], repo);
    await Bun.write(path.join(repo, "f.txt"), "stack-1\n");
    git(["add", "f.txt"], repo);
    git(["commit", "-m", "stack 1"], repo);
    const stack1InitSha = git(["rev-parse", "stack-1"], repo);

    git(["checkout", "-b", "stack-2"], repo);
    await Bun.write(path.join(repo, "top.txt"), "stack-2\n");
    git(["add", "top.txt"], repo);
    git(["commit", "-m", "stack 2"], repo);

    await seedSpiceDataRef(
      repo,
      { trunk: "main", remote: "origin" },
      {
        "stack-1": { base: { name: "main", hash: initMainSha } },
        "stack-2": { base: { name: "stack-1", hash: stack1InitSha } },
      },
      { makeTempDir },
    );

    git(["checkout", "main"], repo);
    await Bun.write(path.join(repo, "f.txt"), "main-v2\n");
    git(["add", "f.txt"], repo);
    git(["commit", "-m", "main v2"], repo);
    const mainSha = git(["rev-parse", "main"], repo);

    git(["checkout", "stack-1"], repo);
    const upstack = await runGitSpice(
      ["upstack", "restack"],
      { ...shimEnv },
      { cwd: repo, stdin: "ignore" },
    );
    expect(upstack).not.toBe(0);

    await Bun.write(path.join(repo, "f.txt"), "stack-1-resolved\n");
    git(["add", "f.txt"], repo);

    const exit = await runGitSpice(
      ["rebase", "continue", "--no-edit"],
      { ...shimEnv },
      { cwd: repo, stdin: "ignore" },
    );
    expect(exit).toBe(0);

    expect(git(["rev-parse", "stack-1~1"], repo)).toBe(mainSha);
    expect(git(["rev-parse", "stack-2~1"], repo)).toBe(
      git(["rev-parse", "stack-1"], repo),
    );
  });
});
