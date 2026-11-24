import { afterEach, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isBranchMergeSubcommand,
  runGitSpiceBranchMerge,
} from "#lib/git-spice/merge.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  }
  return stdout.trim();
}

async function writeSpiceData(
  repoDir: string,
  repoConfig: Record<string, unknown>,
  branches: Record<string, Record<string, unknown>>,
): Promise<void> {
  const staging = await mkdtemp(path.join(tmpdir(), "toolkit-spice-stage-"));
  temporaryDirectories.push(staging);
  await git(staging, ["init"]);
  await git(staging, ["config", "commit.gpgsign", "false"]);
  await git(staging, ["config", "user.email", "test@example.com"]);
  await git(staging, ["config", "user.name", "Toolkit Test"]);
  await Bun.write(path.join(staging, "repo"), JSON.stringify(repoConfig));
  for (const [name, payload] of Object.entries(branches)) {
    const filePath = path.join(staging, "branches", ...name.split("/"));
    await mkdir(path.dirname(filePath), { recursive: true });
    await Bun.write(filePath, JSON.stringify(payload));
  }
  await git(staging, ["add", "."]);
  await git(staging, ["commit", "-m", "spice data"]);
  const commitSha = await git(staging, ["rev-parse", "HEAD"]);
  await git(repoDir, ["fetch", staging, commitSha]);
  await git(repoDir, ["update-ref", "refs/spice/data", commitSha]);
}

async function createTempRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "toolkit-gs-merge-"));
  temporaryDirectories.push(root);
  const repo = path.join(root, "repo");
  await mkdir(repo);
  await git(repo, ["init"]);
  await git(repo, ["config", "commit.gpgsign", "false"]);
  await git(repo, ["config", "user.email", "test@example.com"]);
  await git(repo, ["config", "user.name", "Toolkit Test"]);
  await Bun.write(path.join(repo, "README.md"), "initial\n");
  await git(repo, ["add", "README.md"]);
  await git(repo, ["commit", "-m", "init"]);
  await git(repo, ["branch", "-M", "main"]);
  await git(repo, [
    "remote",
    "add",
    "origin",
    "https://github.com/acme/monorepo.git",
  ]);
  return repo;
}

describe("isBranchMergeSubcommand", () => {
  test.each([
    [["branch", "merge"]],
    [["b", "merge"]],
    [["branch", "m"]],
    [["b", "m"]],
    [["bm"]],
    [["-C", "/tmp/worktree", "branch", "merge", "--method", "squash"]],
    [["--dir=/tmp/worktree", "--no-prompt", "bm"]],
    [["-C/tmp/worktree", "-v", "b", "m", "--branch", "feat/x"]],
  ])("matches %j", (args) => {
    expect(isBranchMergeSubcommand(args)).toBe(true);
  });

  test.each([
    [[]],
    [["--help"]],
    [["stack", "merge"]],
    [["sm"]],
    [["downstack", "merge"]],
    [["dsm"]],
    [["branch", "submit"]],
    [["bs"]],
    [["--", "branch", "merge"]],
  ])("rejects %j", (args) => {
    expect(isBranchMergeSubcommand(args)).toBe(false);
  });
});

describe("runGitSpiceBranchMerge (AI-231)", () => {
  test("returns 0 directly when git-spice exits 0 without querying GitHub", async () => {
    const repo = await createTempRepo();
    await git(repo, ["checkout", "-b", "fix/clean-merge"]);
    await writeSpiceData(
      repo,
      { trunk: "main", remote: "origin" },
      {
        "fix/clean-merge": {
          base: { name: "main" },
          change: { github: { pr: { number: 3594 } } },
        },
      },
    );

    let fetchCount = 0;
    const logs: string[] = [];
    const code = await runGitSpiceBranchMerge(
      ["branch", "merge", "--method", "squash"],
      {
        cwd: repo,
        githubToken: "test-token",
        spawnGitSpice: async () => 0,
        fetchImpl: async () => {
          fetchCount += 1;
          return new Response("{}", { status: 200 });
        },
        stderr: (msg) => {
          logs.push(msg);
        },
      },
    );

    expect(code).toBe(0);
    expect(fetchCount).toBe(0);
    expect(logs).toEqual([]);
  });

  test("returns 0 with WARN when remote PR merged, no upstack exists, and post-merge trunk sync fails", async () => {
    const repo = await createTempRepo();
    await git(repo, ["checkout", "-b", "fix/scout-recorded-augment-names"]);
    await writeSpiceData(
      repo,
      { trunk: "main", remote: "origin" },
      {
        "fix/scout-recorded-augment-names": {
          base: { name: "main" },
          change: { github: { pr: { number: 3594 } } },
        },
        "unrelated/other-branch": {
          base: { name: "main" },
          change: { github: { pr: { number: 3600 } } },
        },
      },
    );

    const requestedUrls: string[] = [];
    const logs: string[] = [];
    const mergeSha = "c6fb077172c736af9448b25552ab817596faf941";

    const code = await runGitSpiceBranchMerge(
      [
        "branch",
        "merge",
        "--method",
        "squash",
        "--ready-timeout",
        "0",
        "--no-prompt",
      ],
      {
        cwd: repo,
        githubToken: "test-token",
        spawnGitSpice: async () => {
          // Simulate git-spice deleting branch metadata after GitHub merge, then failing on trunk sync.
          await writeSpiceData(
            repo,
            { trunk: "main", remote: "origin" },
            {
              "unrelated/other-branch": {
                base: { name: "main" },
                change: { github: { pr: { number: 3600 } } },
              },
            },
          );
          return 1;
        },
        fetchImpl: async (input) => {
          requestedUrls.push(
            typeof input === "string" ? input : input.toString(),
          );
          return Response.json({
            number: 3594,
            merged: true,
            merge_commit_sha: mergeSha,
          });
        },
        stderr: (msg) => {
          logs.push(msg);
        },
      },
    );

    expect(code).toBe(0);
    expect(requestedUrls).toEqual([
      "https://api.github.com/repos/acme/monorepo/pulls/3594",
    ]);
    expect(logs).toEqual([
      `WARN toolkit: PR #3594 merged on GitHub (${mergeSha}); git-spice post-merge local trunk sync exited 1 (other worktrees left untouched).`,
    ]);
  });

  test("returns original non-zero exit code with ERROR when remote PR merged but upstack branches remain", async () => {
    const repo = await createTempRepo();
    await git(repo, ["checkout", "-b", "feat/stack-bottom"]);
    await writeSpiceData(
      repo,
      { trunk: "main", remote: "origin" },
      {
        "feat/stack-bottom": {
          base: { name: "main" },
          change: { github: { pr: { number: 4100 } } },
        },
        "feat/stack-top-b": {
          base: { name: "feat/stack-bottom" },
          change: { github: { pr: { number: 4102 } } },
        },
        "feat/stack-top-a": {
          base: { name: "feat/stack-bottom" },
          change: { github: { pr: { number: 4101 } } },
        },
      },
    );

    const logs: string[] = [];
    const mergeSha = "99887766554433221100ffeeddccbbaa11223344";
    const code = await runGitSpiceBranchMerge(["bm", "--method=squash"], {
      cwd: repo,
      githubToken: "test-token",
      spawnGitSpice: async () => 1,
      fetchImpl: async () =>
        Response.json({
          number: 4100,
          merged: true,
          merge_commit_sha: mergeSha,
        }),
      stderr: (msg) => {
        logs.push(msg);
      },
    });

    expect(code).toBe(1);
    expect(logs).toEqual([
      `ERROR toolkit: PR #4100 merged on GitHub (${mergeSha}) — do NOT retry merging #4100 — but git-spice exited 1 before reconciling upstack branch(es): feat/stack-top-a, feat/stack-top-b.`,
    ]);
  });

  test("preserves non-zero exit code when PR is not merged on GitHub or token is absent", async () => {
    const repo = await createTempRepo();
    await git(repo, ["checkout", "main"]);
    await git(repo, ["branch", "feat/not-merged"]);
    await writeSpiceData(
      repo,
      { trunk: "main", remote: "origin" },
      {
        "feat/not-merged": {
          base: { name: "main" },
          change: { github: { pr: { number: 4200 } } },
        },
      },
    );

    const parentDir = path.dirname(repo);
    const logs: string[] = [];
    const unmergedCode = await runGitSpiceBranchMerge(
      ["-C", repo, "b", "merge", "--branch", "feat/not-merged"],
      {
        cwd: parentDir,
        githubToken: "test-token",
        spawnGitSpice: async () => 1,
        fetchImpl: async () =>
          Response.json({
            number: 4200,
            merged: false,
            merge_commit_sha: null,
          }),
        stderr: (msg) => {
          logs.push(msg);
        },
      },
    );

    expect(unmergedCode).toBe(1);
    expect(logs).toEqual([]);

    const noTokenCode = await runGitSpiceBranchMerge(
      ["branch", "merge", "--branch=feat/not-merged"],
      {
        cwd: repo,
        githubToken: null,
        spawnGitSpice: async () => 2,
        stderr: (msg) => {
          logs.push(msg);
        },
      },
    );
    expect(noTokenCode).toBe(2);
    expect(logs).toEqual([]);
  });
});
