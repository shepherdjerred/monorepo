import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runGitSpice } from "#lib/git-spice/run.ts";
import {
  readSpiceBranches,
  readSpiceRebaseContinue,
} from "#lib/git-spice/spice-state.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function git(args: readonly string[], cwd: string): string {
  const res = Bun.spawnSync(["git", ...args], { cwd, env: Bun.env });
  if (res.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (${String(res.exitCode)}): ${res.stderr.toString()}`,
    );
  }
  return res.stdout.toString().trim();
}

describe("rebase continue isolation across worktrees (AI-154)", () => {
  test("completes git rebase --continue and updates base.hash without touching another worktree's continuation", async () => {
    const root = await makeTempDir("toolkit-spice-ai154-");
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

    const init = Bun.spawnSync(
      [
        "git-spice",
        "--no-prompt",
        "repo",
        "init",
        "--trunk",
        "main",
        "--remote",
        "origin",
      ],
      { cwd: mainWt, env: Bun.env },
    );
    expect(init.exitCode).toBe(0);

    git(
      ["worktree", "add", "-b", "refactor/other-worktree", wtA, "main"],
      mainWt,
    );
    Bun.spawnSync(
      [
        "git-spice",
        "--no-prompt",
        "branch",
        "track",
        "--base",
        "main",
        "refactor/other-worktree",
      ],
      { cwd: wtA, env: Bun.env },
    );

    git(["worktree", "add", "-b", "feat/my-branch", wtB, "main"], mainWt);
    Bun.spawnSync(
      [
        "git-spice",
        "--no-prompt",
        "branch",
        "track",
        "--base",
        "main",
        "feat/my-branch",
      ],
      { cwd: wtB, env: Bun.env },
    );
    await Bun.write(path.join(wtB, "shared.txt"), "from my-branch\n");
    git(["add", "shared.txt"], wtB);
    git(["commit", "-m", "feat: update shared"], wtB);

    await Bun.write(path.join(mainWt, "shared.txt"), "from main v2\n");
    git(["add", "shared.txt"], mainWt);
    git(["commit", "-m", "main: conflicting update"], mainWt);
    const newMainSha = git(["rev-parse", "main"], mainWt);

    const restack = Bun.spawnSync(
      ["git-spice", "--no-prompt", "branch", "restack"],
      { cwd: wtB, env: Bun.env },
    );
    expect(restack.exitCode).not.toBe(0);

    const spiceClone = path.join(root, "spice-edit");
    git(["clone", mainWt, spiceClone], root);
    git(
      ["fetch", "origin", "refs/spice/data:refs/heads/spice-data"],
      spiceClone,
    );
    git(["checkout", "spice-data"], spiceClone);
    git(["config", "user.name", "Test"], spiceClone);
    git(["config", "user.email", "test@example.com"], spiceClone);
    await Bun.write(
      path.join(spiceClone, "rebase-continue"),
      JSON.stringify({
        continuations: [
          {
            command: ["branch", "restack"],
            branch: "refactor/other-worktree",
          },
        ],
      }),
    );
    git(["add", "rebase-continue"], spiceClone);
    git(["commit", "-m", "foreign continuation"], spiceClone);
    git(["push", mainWt, "spice-data:refs/spice/data"], spiceClone);

    await Bun.write(path.join(wtB, "shared.txt"), "resolved content\n");
    git(["add", "shared.txt"], wtB);

    const exitCode = await runGitSpice(
      ["rbc", "--no-edit"],
      { ...Bun.env },
      { cwd: wtB, stdin: "ignore" },
    );
    expect(exitCode).toBe(0);

    expect(git(["branch", "--show-current"], wtB)).toBe("feat/my-branch");
    expect(git(["rev-parse", "HEAD~1"], wtB)).toBe(newMainSha);

    const branches = await readSpiceBranches(wtB, Bun.env);
    expect(branches.get("feat/my-branch")?.baseHash).toBe(newMainSha);

    const continuations = await readSpiceRebaseContinue(wtB, Bun.env);
    expect(continuations).toEqual([
      {
        command: ["branch", "restack"],
        branch: "refactor/other-worktree",
      },
    ]);
  });

  test("delegates to native git-spice rebase continue when continuation belongs to same stack in same worktree", async () => {
    const root = await makeTempDir("toolkit-spice-ai154-stack-");
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

    Bun.spawnSync(
      [
        "git-spice",
        "--no-prompt",
        "repo",
        "init",
        "--trunk",
        "main",
        "--remote",
        "origin",
      ],
      { cwd: repo, env: Bun.env },
    );

    await Bun.write(path.join(repo, "f.txt"), "stack-1\n");
    git(["add", "f.txt"], repo);
    Bun.spawnSync(
      [
        "git-spice",
        "--no-prompt",
        "branch",
        "create",
        "stack-1",
        "-m",
        "stack 1",
      ],
      { cwd: repo, env: Bun.env },
    );

    await Bun.write(path.join(repo, "top.txt"), "stack-2\n");
    git(["add", "top.txt"], repo);
    Bun.spawnSync(
      [
        "git-spice",
        "--no-prompt",
        "branch",
        "create",
        "stack-2",
        "-m",
        "stack 2",
      ],
      { cwd: repo, env: Bun.env },
    );

    git(["checkout", "main"], repo);
    await Bun.write(path.join(repo, "f.txt"), "main-v2\n");
    git(["add", "f.txt"], repo);
    git(["commit", "-m", "main v2"], repo);
    const mainSha = git(["rev-parse", "main"], repo);

    git(["checkout", "stack-1"], repo);
    const upstack = Bun.spawnSync(
      ["git-spice", "--no-prompt", "upstack", "restack"],
      { cwd: repo, env: Bun.env },
    );
    expect(upstack.exitCode).not.toBe(0);

    await Bun.write(path.join(repo, "f.txt"), "stack-1-resolved\n");
    git(["add", "f.txt"], repo);

    const exit = await runGitSpice(
      ["rebase", "continue", "--no-edit"],
      { ...Bun.env },
      { cwd: repo, stdin: "ignore" },
    );
    expect(exit).toBe(0);

    expect(git(["rev-parse", "stack-1~1"], repo)).toBe(mainSha);
    expect(git(["rev-parse", "stack-2~1"], repo)).toBe(
      git(["rev-parse", "stack-1"], repo),
    );
  });
});
