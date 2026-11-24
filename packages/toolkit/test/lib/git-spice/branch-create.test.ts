import path from "node:path";
import { describe, expect, test } from "vitest";
import { extractTargetFlag } from "#lib/git-spice/branch-create.ts";
import { runGitSpice } from "#lib/git-spice/run.ts";
import {
  readGitConfig,
  readSpiceBranches,
} from "#lib/git-spice/spice-state.ts";
import {
  registerTempDirs,
  runGitSync as git,
  seedSpiceDataRef,
} from "./spice-test-harness.ts";

const { makeTempDir, installGitSpiceShim } = registerTempDirs();

async function setupPrimaryAndWorktree() {
  const root = await makeTempDir("toolkit-spice-ai755-");
  const shimEnv = await installGitSpiceShim(Bun.env);
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
  await seedSpiceDataRef(
    primary,
    { trunk: "main", remote: "origin" },
    {},
    { makeTempDir },
  );

  git(["clone", remote, otherClone], root);
  git(["config", "user.name", "Test"], otherClone);
  git(["config", "user.email", "test@example.com"], otherClone);
  await Bun.write(path.join(otherClone, "README.md"), "v2\n");
  git(["add", "README.md"], otherClone);
  git(["commit", "-m", "c2"], otherClone);
  git(["push", "origin", "main"], otherClone);
  git(["fetch", "origin"], primary);

  const originMainSha = git(["rev-parse", "origin/main"], primary);
  return { root, remote, primary, originMainSha, shimEnv };
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
    const { root, primary, originMainSha, shimEnv } =
      await setupPrimaryAndWorktree();
    const agentWt = path.join(root, "agent-wt");
    git(
      ["worktree", "add", "-b", "herdr-wt-1", agentWt, "origin/main"],
      primary,
    );

    await Bun.write(path.join(agentWt, "feature.ts"), "export const x = 1;\n");
    git(["add", "feature.ts"], agentWt);
    const exit = await runGitSpice(
      ["branch", "create", "feat/without-target", "-m", "feat: add x"],
      { ...shimEnv },
      { cwd: agentWt, stdin: "ignore" },
    );
    expect(exit).toBe(0);

    expect(git(["branch", "--show-current"], agentWt)).toBe(
      "feat/without-target",
    );
    expect(git(["rev-parse", "HEAD~1"], agentWt)).toBe(originMainSha);

    const branches = await readSpiceBranches(agentWt, shimEnv);
    expect(branches.get("feat/without-target")?.baseName).toBe("main");
    expect(branches.has("herdr-wt-1")).toBe(false);
    expect(
      await readGitConfig(agentWt, "branch.feat/without-target.merge", shimEnv),
    ).toBeNull();
  });

  test("succeeds with --target main and relative -C -t origin/main while main is checked out in primary worktree", async () => {
    const { root, primary, originMainSha, shimEnv } =
      await setupPrimaryAndWorktree();
    const wt1 = path.join(root, "wt-target-main");
    git(["worktree", "add", "-b", "herdr-wt-2", wt1, "origin/main"], primary);

    await Bun.write(path.join(wt1, "one.ts"), "export const one = 1;\n");
    git(["add", "one.ts"], wt1);
    const exitMain = await runGitSpice(
      ["bc", "feat/target-main", "--target", "main", "-m", "feat: one"],
      { ...shimEnv },
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
        "wt-target-origin-main",
        "b",
        "c",
        "feat/target-origin-main",
        "-t",
        "origin/main",
        "-m",
        "feat: two",
      ],
      { ...shimEnv },
      { cwd: root, stdin: "ignore" },
    );
    expect(exitOriginMain).toBe(0);
    expect(git(["branch", "--show-current"], wt2)).toBe(
      "feat/target-origin-main",
    );

    const branches = await readSpiceBranches(primary, shimEnv);
    expect(branches.get("feat/target-main")?.baseName).toBe("main");
    expect(branches.get("feat/target-origin-main")?.baseName).toBe("main");
    expect(branches.has("herdr-wt-2")).toBe(false);
    expect(branches.has("herdr-wt-3")).toBe(false);
    expect(git(["branch", "--show-current"], primary)).toBe("main");
  });

  test("keeps <cur> tracked on trunk so <newBranch> stacks on <cur> when <cur> has commits ahead of trunk and --target is omitted", async () => {
    const { root, primary, shimEnv } = await setupPrimaryAndWorktree();
    const stackWt = path.join(root, "stack-wt");
    git(
      ["worktree", "add", "-b", "feat/part-1", stackWt, "origin/main"],
      primary,
    );
    git(["config", "branch.feat/part-1.remote", "."], stackWt);
    git(["config", "branch.feat/part-1.merge", "refs/heads/main"], stackWt);

    await Bun.write(path.join(stackWt, "part1.ts"), "export const p1 = 1;\n");
    git(["add", "part1.ts"], stackWt);
    git(["commit", "-m", "feat: part 1"], stackWt);
    expect(
      await readGitConfig(stackWt, "branch.feat/part-1.merge", shimEnv),
    ).toBe("refs/heads/main");

    await Bun.write(path.join(stackWt, "part2.ts"), "export const p2 = 2;\n");
    git(["add", "part2.ts"], stackWt);
    const exit = await runGitSpice(
      ["branch", "create", "feat/part-2", "-m", "feat: part 2"],
      { ...shimEnv },
      { cwd: stackWt, stdin: "ignore", command: "spice" },
    );
    expect(exit).toBe(0);

    const branches = await readSpiceBranches(stackWt, shimEnv);
    expect(branches.get("feat/part-1")?.baseName).toBe("main");
    expect(branches.get("feat/part-2")?.baseName).toBe("feat/part-1");
    expect(
      await readGitConfig(stackWt, "branch.feat/part-1.merge", shimEnv),
    ).toBeNull();
  });
});
