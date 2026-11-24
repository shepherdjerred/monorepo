import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { extractTargetFlag } from "#lib/git-spice/branch-create.ts";
import { runGitSpice } from "#lib/git-spice/run.ts";
import {
  readGitConfig,
  readSpiceBranches,
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

async function setupPrimaryAndWorktree() {
  const root = await makeTempDir("toolkit-spice-ai755-");
  const remote = path.join(root, "remote.git");
  const primary = path.join(root, "primary");
  const otherClone = path.join(root, "other");

  git(["init", "--bare", "-b", "main", remote], root);
  git(["clone", remote, primary], root);
  git(["config", "user.name", "Test"], primary);
  git(["config", "user.email", "test@example.com"], primary);
  await Bun.write(path.join(primary, "README.md"), "v1\n");
  git(["add", "README.md"], primary);
  git(["commit", "-m", "c1"], primary);
  git(["push", "-u", "origin", "main"], primary);

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
    { cwd: primary, env: Bun.env },
  );
  expect(init.exitCode).toBe(0);

  git(["clone", remote, otherClone], root);
  git(["config", "user.name", "Test"], otherClone);
  git(["config", "user.email", "test@example.com"], otherClone);
  await Bun.write(path.join(otherClone, "README.md"), "v2\n");
  git(["add", "README.md"], otherClone);
  git(["commit", "-m", "c2"], otherClone);
  git(["push", "origin", "main"], otherClone);
  git(["fetch", "origin"], primary);

  const originMainSha = git(["rev-parse", "origin/main"], primary);
  return { root, remote, primary, originMainSha };
}

describe("branch create in agent worktrees (AI-755 & AI-2)", () => {
  test("extractTargetFlag parses and strips all -t/--target forms before --", () => {
    expect(
      extractTargetFlag(["bc", "feat", "--target", "main", "-m", "msg"]),
    ).toEqual({
      target: "main",
      strippedArgs: ["bc", "feat", "-m", "msg"],
    });
    expect(
      extractTargetFlag([
        "bc",
        "feat",
        "--target=origin/main",
        "--",
        "-t",
        "keep",
      ]),
    ).toEqual({
      target: "origin/main",
      strippedArgs: ["bc", "feat", "--", "-t", "keep"],
    });
    expect(extractTargetFlag(["bc", "-tmain", "feat"])).toEqual({
      target: "main",
      strippedArgs: ["bc", "feat"],
    });
  });

  test("creates branch tracked on trunk from untracked worktree branch at origin/main without --target", async () => {
    const { root, primary, originMainSha } = await setupPrimaryAndWorktree();
    const agentWt = path.join(root, "agent-wt");
    git(
      ["worktree", "add", "-b", "herdr-wt-1", agentWt, "origin/main"],
      primary,
    );

    await Bun.write(path.join(agentWt, "feature.ts"), "export const x = 1;\n");
    git(["add", "feature.ts"], agentWt);
    const exit = await runGitSpice(
      ["branch", "create", "feat/without-target", "-m", "feat: add x"],
      { ...Bun.env },
      { cwd: agentWt, stdin: "ignore" },
    );
    expect(exit).toBe(0);

    expect(git(["branch", "--show-current"], agentWt)).toBe(
      "feat/without-target",
    );
    expect(git(["rev-parse", "HEAD~1"], agentWt)).toBe(originMainSha);

    const branches = await readSpiceBranches(agentWt, Bun.env);
    expect(branches.get("feat/without-target")?.baseName).toBe("main");
    expect(branches.has("herdr-wt-1")).toBe(false);
    expect(
      await readGitConfig(agentWt, "branch.feat/without-target.merge", Bun.env),
    ).toBeNull();
  });

  test("succeeds with --target main and -t origin/main while main is checked out in primary worktree", async () => {
    const { root, primary, originMainSha } = await setupPrimaryAndWorktree();
    const wt1 = path.join(root, "wt-target-main");
    git(["worktree", "add", "-b", "herdr-wt-2", wt1, "origin/main"], primary);

    await Bun.write(path.join(wt1, "one.ts"), "export const one = 1;\n");
    git(["add", "one.ts"], wt1);
    const exitMain = await runGitSpice(
      ["bc", "feat/target-main", "--target", "main", "-m", "feat: one"],
      { ...Bun.env },
      { cwd: wt1, stdin: "ignore" },
    );
    expect(exitMain).toBe(0);
    expect(git(["branch", "--show-current"], wt1)).toBe("feat/target-main");
    expect(git(["rev-parse", "HEAD~1"], wt1)).toBe(originMainSha);

    const wt2 = path.join(root, "wt-target-origin-main");
    git(["worktree", "add", "-b", "herdr-wt-3", wt2, "origin/main"], primary);
    await Bun.write(path.join(wt2, "two.ts"), "export const two = 2;\n");
    git(["add", "two.ts"], wt2);
    const exitOriginMain = await runGitSpice(
      [
        "-C",
        wt2,
        "b",
        "c",
        "feat/target-origin-main",
        "-t",
        "origin/main",
        "-m",
        "feat: two",
      ],
      { ...Bun.env },
      { cwd: root, stdin: "ignore" },
    );
    expect(exitOriginMain).toBe(0);
    expect(git(["branch", "--show-current"], wt2)).toBe(
      "feat/target-origin-main",
    );

    const branches = await readSpiceBranches(primary, Bun.env);
    expect(branches.get("feat/target-main")?.baseName).toBe("main");
    expect(branches.get("feat/target-origin-main")?.baseName).toBe("main");
    expect(branches.has("herdr-wt-2")).toBe(false);
    expect(branches.has("herdr-wt-3")).toBe(false);
    expect(git(["branch", "--show-current"], primary)).toBe("main");
  });

  test("keeps <cur> tracked on trunk so <newBranch> stacks on <cur> when <cur> has commits ahead of trunk and --target is omitted", async () => {
    const { root, primary } = await setupPrimaryAndWorktree();
    const stackWt = path.join(root, "stack-wt");
    git(
      ["worktree", "add", "-b", "feat/part-1", stackWt, "origin/main"],
      primary,
    );

    await Bun.write(path.join(stackWt, "part1.ts"), "export const p1 = 1;\n");
    git(["add", "part1.ts"], stackWt);
    git(["commit", "-m", "feat: part 1"], stackWt);
    expect(
      await readGitConfig(stackWt, "branch.feat/part-1.merge", Bun.env),
    ).toBe("refs/heads/main");

    await Bun.write(path.join(stackWt, "part2.ts"), "export const p2 = 2;\n");
    git(["add", "part2.ts"], stackWt);
    const exit = await runGitSpice(
      ["branch", "create", "feat/part-2", "-m", "feat: part 2"],
      { ...Bun.env },
      { cwd: stackWt, stdin: "ignore", command: "spice" },
    );
    expect(exit).toBe(0);

    const branches = await readSpiceBranches(stackWt, Bun.env);
    expect(branches.get("feat/part-1")?.baseName).toBe("main");
    expect(branches.get("feat/part-2")?.baseName).toBe("feat/part-1");
    expect(
      await readGitConfig(stackWt, "branch.feat/part-1.merge", Bun.env),
    ).toBeNull();
  });
});
