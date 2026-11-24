import { afterEach, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isBranchSubmitSubcommand,
  isSubmitSubcommand,
  runGitSpiceSubmit,
} from "#lib/git-spice/submit.ts";

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
    const detail = stderr.length > 0 ? stderr : stdout;
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
  return stdout.trim();
}

async function gitExitCode(
  cwd: string,
  args: readonly string[],
): Promise<number> {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  return child.exited;
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

type TempGitSetup = {
  readonly root: string;
  readonly origin: string;
  readonly repo: string;
};

async function createTempRepoWithOrigin(
  trunk = "main",
  remote = "origin",
): Promise<TempGitSetup> {
  const root = await mkdtemp(path.join(tmpdir(), "toolkit-gs-submit-"));
  temporaryDirectories.push(root);
  const origin = path.join(root, "origin.git");
  const repo = path.join(root, "repo");
  await mkdir(repo);
  await git(root, ["init", "--bare", origin]);
  await git(repo, ["init"]);
  await git(repo, ["config", "commit.gpgsign", "false"]);
  await git(repo, ["config", "user.email", "test@example.com"]);
  await git(repo, ["config", "user.name", "Toolkit Test"]);
  await Bun.write(path.join(repo, "file.txt"), "base\n");
  await git(repo, ["add", "file.txt"]);
  await git(repo, ["commit", "-m", "base"]);
  await git(repo, ["branch", "-M", trunk]);
  await git(repo, ["remote", "add", remote, origin]);
  await git(repo, ["push", "-u", remote, trunk]);
  return { root, origin, repo };
}

describe("isSubmitSubcommand and isBranchSubmitSubcommand", () => {
  test.each([
    [["branch", "submit"], true, true],
    [["b", "submit"], true, true],
    [["branch", "s"], true, true],
    [["b", "s"], true, true],
    [["bs"], true, true],
    [
      ["-C", "/tmp/wt", "--no-prompt", "branch", "submit", "--draft"],
      true,
      true,
    ],
    [["--dir=/tmp/wt", "-v", "bs", "--no-draft"], true, true],
    [["stack", "submit"], true, false],
    [["s", "submit"], true, false],
    [["stack", "s"], true, false],
    [["ss"], true, false],
    [["upstack", "submit"], true, false],
    [["us", "s"], true, false],
    [["uss"], true, false],
    [["downstack", "submit"], true, false],
    [["ds", "submit"], true, false],
    [["dss"], true, false],
    [["branch", "merge"], false, false],
    [["bm"], false, false],
    [["repo", "sync"], false, false],
    [["--version"], false, false],
    [["--", "bs"], false, false],
  ])(
    "classifies %j -> submit=%s branchSubmit=%s",
    (args, expectedSubmit, expectedBranch) => {
      expect(isSubmitSubcommand(args)).toBe(expectedSubmit);
      expect(isBranchSubmitSubcommand(args)).toBe(expectedBranch);
    },
  );
});

describe("AI-337 (--body-file)", () => {
  test("replaces --body-file and --body-file= before -- with [--body, contents]", async () => {
    const { repo, origin } = await createTempRepoWithOrigin();
    await git(repo, [
      "checkout",
      "--no-track",
      "-b",
      "feat/body-file",
      "origin/main",
    ]);
    await Bun.write(path.join(repo, "file.txt"), "change\n");
    await git(repo, ["commit", "-am", "feat"]);

    const bodyPath = path.join(repo, "pr-body.md");
    const markdown =
      "## Why\nFix substitution guard\n\n## Demo\nBefore / After\n";
    await Bun.write(bodyPath, markdown);

    const spawnedArgs: (readonly string[])[] = [];
    const code1 = await runGitSpiceSubmit(
      [
        "branch",
        "submit",
        "--draft",
        "--body-file",
        bodyPath,
        "--",
        "--body-file",
        "literal",
      ],
      {
        cwd: repo,
        githubToken: null,
        spawnGitSpice: async (args) => {
          spawnedArgs.push(args);
          await git(repo, ["push", origin, "HEAD:refs/heads/feat/body-file"]);
          return 0;
        },
      },
    );

    expect(code1).toBe(0);
    expect(spawnedArgs[0]).toEqual([
      "branch",
      "submit",
      "--draft",
      "--body",
      markdown,
      "--",
      "--body-file",
      "literal",
    ]);

    const code2 = await runGitSpiceSubmit(["bs", `--body-file=${bodyPath}`], {
      cwd: repo,
      githubToken: null,
      spawnGitSpice: async (args) => {
        spawnedArgs.push(args);
        return 0;
      },
    });
    expect(code2).toBe(0);
    expect(spawnedArgs[1]).toEqual(["bs", "--body", markdown]);
  });

  test("exits 2 cleanly when combined with --body, missing path, or unreadable file", async () => {
    const { repo } = await createTempRepoWithOrigin();
    const bodyPath = path.join(repo, "valid.md");
    await Bun.write(bodyPath, "hello");

    let spawned = 0;
    const logs: string[] = [];

    const combined = await runGitSpiceSubmit(
      ["branch", "submit", "--body", "inline", "--body-file", bodyPath],
      {
        cwd: repo,
        spawnGitSpice: async () => {
          spawned += 1;
          return 0;
        },
        stderr: (msg) => {
          logs.push(msg);
        },
      },
    );
    expect(combined).toBe(2);

    const missingFile = await runGitSpiceSubmit(
      ["branch", "submit", "--body-file", path.join(repo, "does-not-exist.md")],
      {
        cwd: repo,
        spawnGitSpice: async () => {
          spawned += 1;
          return 0;
        },
        stderr: (msg) => {
          logs.push(msg);
        },
      },
    );
    expect(missingFile).toBe(2);

    const missingArg = await runGitSpiceSubmit(
      ["branch", "submit", "--body-file"],
      {
        cwd: repo,
        spawnGitSpice: async () => {
          spawned += 1;
          return 0;
        },
        stderr: (msg) => {
          logs.push(msg);
        },
      },
    );
    expect(missingArg).toBe(2);
    expect(spawned).toBe(0);
    expect(logs.length).toBe(3);
  });
});

describe("AI-664 (clear trunk upstream before submit)", () => {
  test("clears non-trunk branches tracking remote/trunk while preserving trunk and own upstreams", async () => {
    const { repo, origin } = await createTempRepoWithOrigin();
    // Create branch tracking origin/main (mirrors `git worktree add -b feat/wt origin/main`)
    await git(repo, ["checkout", "--track", "-b", "feat/wt", "origin/main"]);
    await Bun.write(path.join(repo, "file.txt"), "wt change\n");
    await git(repo, ["commit", "-am", "wt change"]);

    // Also create another branch tracking its own remote branch (must be preserved)
    await git(repo, ["branch", "feat/own", "HEAD"]);
    await git(repo, ["push", "-u", "origin", "feat/own"]);

    await writeSpiceData(
      repo,
      { trunk: "main", remote: "origin" },
      { "feat/wt": { base: { name: "main" } } },
    );

    const logs: string[] = [];
    // Dry-run must NOT clear upstream
    const dryCode = await runGitSpiceSubmit(["branch", "submit", "--dry-run"], {
      cwd: repo,
      githubToken: null,
      spawnGitSpice: async () => 0,
      stderr: (msg) => {
        logs.push(msg);
      },
    });
    expect(dryCode).toBe(0);
    expect(logs).toEqual([]);
    expect(
      await git(repo, ["rev-parse", "--abbrev-ref", "feat/wt@{upstream}"]),
    ).toBe("origin/main");

    // Live submit clears feat/wt's origin/main upstream, preserves main and feat/own
    const liveCode = await runGitSpiceSubmit(["branch", "submit", "--draft"], {
      cwd: repo,
      githubToken: null,
      spawnGitSpice: async () => {
        await git(repo, ["push", origin, "HEAD:refs/heads/feat/wt"]);
        return 0;
      },
      stderr: (msg) => {
        logs.push(msg);
      },
    });

    expect(liveCode).toBe(0);
    expect(logs).toEqual([
      "toolkit: cleared origin/main upstream on branch feat/wt",
    ]);
    expect(
      await gitExitCode(repo, ["rev-parse", "feat/wt@{upstream}"]),
    ).not.toBe(0);
    expect(
      await git(repo, ["rev-parse", "--abbrev-ref", "main@{upstream}"]),
    ).toBe("origin/main");
    expect(
      await git(repo, ["rev-parse", "--abbrev-ref", "feat/own@{upstream}"]),
    ).toBe("origin/feat/own");
  });

  test("honors custom trunk/remote from refs/spice/data:repo", async () => {
    const { repo, origin } = await createTempRepoWithOrigin(
      "develop",
      "upstream",
    );
    await git(repo, [
      "checkout",
      "--track",
      "-b",
      "feat/custom",
      "upstream/develop",
    ]);
    await Bun.write(path.join(repo, "file.txt"), "custom\n");
    await git(repo, ["commit", "-am", "custom"]);
    await writeSpiceData(
      repo,
      { trunk: "develop", remote: "upstream" },
      { "feat/custom": { base: { name: "develop" } } },
    );

    const logs: string[] = [];
    const code = await runGitSpiceSubmit(["ss"], {
      cwd: repo,
      githubToken: null,
      spawnGitSpice: async () => {
        await git(repo, ["push", origin, "HEAD:refs/heads/feat/custom"]);
        return 0;
      },
      stderr: (msg) => {
        logs.push(msg);
      },
    });
    expect(code).toBe(0);
    expect(logs).toEqual([
      "toolkit: cleared upstream/develop upstream on branch feat/custom",
    ]);
  });
});

describe("AI-302 (two-phase --no-draft transition)", () => {
  test("pushes first without --no-draft, polls PR head with exponential backoff, then marks ready", async () => {
    const { repo, origin } = await createTempRepoWithOrigin();
    await git(repo, [
      "checkout",
      "--no-track",
      "-b",
      "feat/arcade",
      "origin/main",
    ]);
    await Bun.write(path.join(repo, "file.txt"), "v1\n");
    await git(repo, ["commit", "-am", "v1"]);
    const oldSha = await git(repo, ["rev-parse", "HEAD"]);
    await git(repo, ["push", origin, "HEAD:refs/heads/feat/arcade"]);

    await Bun.write(path.join(repo, "file.txt"), "v2\n");
    await git(repo, ["commit", "-am", "v2"]);
    const newSha = await git(repo, ["rev-parse", "HEAD"]);

    await writeSpiceData(
      repo,
      { trunk: "main", remote: "origin" },
      {
        "feat/arcade": {
          base: { name: "main" },
          upstream: { branch: "feat/arcade" },
          change: { github: { pr: { number: 3848 } } },
        },
      },
    );

    const invocations: (readonly string[])[] = [];
    const sleepCalls: number[] = [];
    let currentTime = 1000;
    let pollReadsAfterPhaseOne = 0;
    let phaseOneCompleted = false;
    let readyFiredAtHead: string | null = null;
    let githubHeadSha = oldSha;

    const code = await runGitSpiceSubmit(
      [
        "--no-prompt",
        "branch",
        "submit",
        "--no-draft",
        "--no-web",
        "--nav-comment=false",
        "--title",
        "feat(arcade): rollout",
      ],
      {
        cwd: repo,
        githubToken: "ghs_test",
        githubRepo: "acme/monorepo",
        now: () => currentTime,
        sleep: async (ms) => {
          sleepCalls.push(ms);
          currentTime += ms;
        },
        spawnGitSpice: async (args) => {
          invocations.push(args);
          if (phaseOneCompleted) {
            readyFiredAtHead = githubHeadSha;
          } else {
            phaseOneCompleted = true;
            await git(repo, ["push", origin, "HEAD:refs/heads/feat/arcade"]);
          }
          return 0;
        },
        fetchImpl: async () => {
          if (phaseOneCompleted) {
            pollReadsAfterPhaseOne += 1;
            if (pollReadsAfterPhaseOne >= 4) {
              githubHeadSha = newSha;
            }
          }
          return Response.json({
            number: 3848,
            state: "open",
            draft: !invocations.some((a) => a.includes("--no-draft")),
            title: "feat(arcade): rollout",
            body: "existing",
            head: { sha: githubHeadSha },
          });
        },
      },
    );

    expect(code).toBe(0);
    expect(invocations).toEqual([
      [
        "--no-prompt",
        "branch",
        "submit",
        "--no-web",
        "--nav-comment=false",
        "--title",
        "feat(arcade): rollout",
      ],
      [
        "--no-prompt",
        "branch",
        "submit",
        "--no-web",
        "--nav-comment=false",
        "--no-draft",
        "--update-only",
      ],
    ]);
    expect(sleepCalls).toEqual([200, 400, 800]);
    expect(readyFiredAtHead).toBe(newSha);
  });

  test("refuses Phase 2 and returns 1 when GitHub PR head never reaches localBranchSha within timeout", async () => {
    const { repo, origin } = await createTempRepoWithOrigin();
    await git(repo, [
      "checkout",
      "--no-track",
      "-b",
      "feat/stuck",
      "origin/main",
    ]);
    await Bun.write(path.join(repo, "file.txt"), "v1\n");
    await git(repo, ["commit", "-am", "v1"]);
    const oldSha = await git(repo, ["rev-parse", "HEAD"]);
    await Bun.write(path.join(repo, "file.txt"), "v2\n");
    await git(repo, ["commit", "-am", "v2"]);

    await writeSpiceData(
      repo,
      { trunk: "main", remote: "origin" },
      {
        "feat/stuck": {
          base: { name: "main" },
          upstream: { branch: "feat/stuck" },
          change: { github: { pr: { number: 3900 } } },
        },
      },
    );

    let currentTime = 0;
    const invocations: (readonly string[])[] = [];
    const logs: string[] = [];

    const code = await runGitSpiceSubmit(["bs", "--draft=false"], {
      cwd: repo,
      githubToken: "ghs_test",
      githubRepo: "acme/monorepo",
      now: () => currentTime,
      sleep: async (ms) => {
        currentTime += ms;
      },
      spawnGitSpice: async (args) => {
        invocations.push(args);
        await git(repo, ["push", origin, "HEAD:refs/heads/feat/stuck"]);
        return 0;
      },
      fetchImpl: async () =>
        Response.json({
          number: 3900,
          state: "open",
          draft: true,
          title: "stuck",
          body: "",
          head: { sha: oldSha },
        }),
      stderr: (msg) => {
        logs.push(msg);
      },
    });

    expect(code).toBe(1);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toEqual(["bs"]);
    expect(
      logs.some((l) => l.includes("refusing to mark ready on stale head")),
    ).toBe(true);
  });
});

describe("AI-400 (verify remote head pushed)", () => {
  test("logs explicit error, skips metadata PATCH, and returns exit code when git-spice fails", async () => {
    const { repo } = await createTempRepoWithOrigin();
    await git(repo, [
      "checkout",
      "--no-track",
      "-b",
      "feat/fail-push",
      "origin/main",
    ]);
    await Bun.write(path.join(repo, "file.txt"), "new\n");
    await git(repo, ["commit", "-am", "new"]);
    const localSha = await git(repo, ["rev-parse", "HEAD"]);

    let patchCalled = false;
    const logs: string[] = [];
    const code = await runGitSpiceSubmit(
      ["branch", "submit", "--title", "new title", "--body", "new body"],
      {
        cwd: repo,
        githubToken: "ghs_test",
        githubRepo: "acme/monorepo",
        spawnGitSpice: async () => 1,
        fetchImpl: async (_url, init) => {
          if (init?.method === "PATCH") {
            patchCalled = true;
          }
          return Response.json({});
        },
        stderr: (msg) => {
          logs.push(msg);
        },
      },
    );

    expect(code).toBe(1);
    expect(patchCalled).toBe(false);
    expect(logs).toEqual([
      `ERROR toolkit: git-spice submit failed (exit 1); local branch feat/fail-push (${localSha}) was NOT pushed or verified.`,
    ]);
  });

  test("returns 1 with SHA mismatch error when git-spice exits 0 without pushing new head", async () => {
    const { repo, origin } = await createTempRepoWithOrigin();
    await git(repo, [
      "checkout",
      "--no-track",
      "-b",
      "rwfbots-stair-walkups",
      "origin/main",
    ]);
    await Bun.write(path.join(repo, "file.txt"), "stale\n");
    await git(repo, ["commit", "-am", "stale"]);
    const staleSha = await git(repo, ["rev-parse", "HEAD"]);
    await git(repo, ["push", origin, "HEAD:refs/heads/remote-stair-walkups"]);

    await Bun.write(path.join(repo, "file.txt"), "amended\n");
    await git(repo, ["commit", "--amend", "-am", "amended"]);
    const newSha = await git(repo, ["rev-parse", "HEAD"]);

    await writeSpiceData(
      repo,
      { trunk: "main", remote: "origin" },
      {
        "rwfbots-stair-walkups": {
          base: { name: "main" },
          upstream: { branch: "remote-stair-walkups" },
          change: { github: { pr: { number: 4132 } } },
        },
      },
    );

    let fetchCount = 0;
    const logs: string[] = [];
    const code = await runGitSpiceSubmit(
      ["branch", "submit", "--title", "updated", "--body", "updated"],
      {
        cwd: repo,
        githubToken: "ghs_test",
        githubRepo: "acme/monorepo",
        spawnGitSpice: async () => 0, // Exited 0 without pushing!
        fetchImpl: async () => {
          fetchCount += 1;
          return Response.json({});
        },
        stderr: (msg) => {
          logs.push(msg);
        },
      },
    );

    expect(code).toBe(1);
    expect(fetchCount).toBe(0);
    expect(logs[0]).toContain("remote head SHA mismatch");
    expect(logs[0]).toContain(newSha);
    expect(logs[0]).toContain(staleSha);
  });
});

describe("AI-80 (update --title / --body on already-open PRs)", () => {
  test("logs WOULD update on --dry-run and PATCHes stale PR title/body on live branch submit", async () => {
    const { repo, origin } = await createTempRepoWithOrigin();
    await git(repo, [
      "checkout",
      "--no-track",
      "-b",
      "feat/ci-woodpecker",
      "origin/main",
    ]);
    await Bun.write(path.join(repo, "file.txt"), "ci\n");
    await git(repo, ["commit", "-am", "ci"]);
    const headSha = await git(repo, ["rev-parse", "HEAD"]);
    await git(repo, ["push", origin, "HEAD:refs/heads/feat/ci-woodpecker"]);

    // Deliberately omit change.github.pr.number to exercise head-query fallback too!
    await writeSpiceData(
      repo,
      { trunk: "main", remote: "origin" },
      {
        "feat/ci-woodpecker": {
          base: { name: "main" },
          upstream: { branch: "feat/ci-woodpecker" },
        },
      },
    );

    const bodyFile = path.join(repo, "body.md");
    await Bun.write(bodyFile, "## Updated Body\nWith Demo");

    const dryLogs: string[] = [];
    let patchCount = 0;
    const dryCode = await runGitSpiceSubmit(
      [
        "b",
        "s",
        "--dry-run",
        "--title",
        "feat(ci): woodpecker",
        "--body-file",
        bodyFile,
      ],
      {
        cwd: repo,
        githubToken: "ghs_test",
        githubRepo: "shepherdjerred/monorepo",
        spawnGitSpice: async () => 0,
        fetchImpl: async (input, init) => {
          const url = typeof input === "string" ? input : input.toString();
          if (init?.method === "PATCH") {
            patchCount += 1;
          }
          if (url.includes("?head=")) {
            return Response.json([{ number: 3121 }]);
          }
          return Response.json({
            number: 3121,
            state: "open",
            draft: true,
            title: "old title",
            body: "old body",
            head: { sha: headSha },
          });
        },
        stderr: (msg) => {
          dryLogs.push(msg);
        },
      },
    );

    expect(dryCode).toBe(0);
    expect(patchCount).toBe(0);
    expect(dryLogs).toEqual(["INF toolkit: WOULD update PR #3121 metadata"]);

    // Live submit: git-spice leaves PR body/title unchanged, wrapper PATCHes and verifies
    let patchedPayload: unknown = null;
    const liveCode = await runGitSpiceSubmit(
      ["bs", "--title", "feat(ci): woodpecker", "--body-file", bodyFile],
      {
        cwd: repo,
        githubToken: "ghs_test",
        githubRepo: "shepherdjerred/monorepo",
        spawnGitSpice: async () => 0,
        fetchImpl: async (input, init) => {
          const url = typeof input === "string" ? input : input.toString();
          if (init?.method === "PATCH") {
            patchCount += 1;
            patchedPayload =
              typeof init.body === "string" ? JSON.parse(init.body) : null;
            return Response.json({
              number: 3121,
              state: "open",
              draft: true,
              title: "feat(ci): woodpecker",
              body: "## Updated Body\nWith Demo",
              head: { sha: headSha },
            });
          }
          if (url.includes("?head=")) {
            return Response.json([{ number: 3121 }]);
          }
          return Response.json({
            number: 3121,
            state: "open",
            draft: true,
            title: "old title",
            body: "old body",
            head: { sha: headSha },
          });
        },
      },
    );

    expect(liveCode).toBe(0);
    expect(patchCount).toBe(1);
    expect(patchedPayload).toEqual({
      title: "feat(ci): woodpecker",
      body: "## Updated Body\nWith Demo",
    });
  });

  test("refuses to PATCH and returns 1 when GitHub PR head mismatches localBranchSha or PR is closed", async () => {
    const { repo, origin } = await createTempRepoWithOrigin();
    await git(repo, [
      "checkout",
      "--no-track",
      "-b",
      "feat/mismatch",
      "origin/main",
    ]);
    await Bun.write(path.join(repo, "file.txt"), "local\n");
    await git(repo, ["commit", "-am", "local"]);
    await git(repo, ["push", origin, "HEAD:refs/heads/feat/mismatch"]);

    await writeSpiceData(
      repo,
      { trunk: "main", remote: "origin" },
      {
        "feat/mismatch": {
          base: { name: "main" },
          upstream: { branch: "feat/mismatch" },
          change: { github: { pr: { number: 3200 } } },
        },
      },
    );

    let patchCalled = false;
    const logs: string[] = [];
    const mismatchCode = await runGitSpiceSubmit(
      ["branch", "submit", "--body", "new body"],
      {
        cwd: repo,
        githubToken: "ghs_test",
        githubRepo: "shepherdjerred/monorepo",
        spawnGitSpice: async () => 0,
        fetchImpl: async (_url, init) => {
          if (init?.method === "PATCH") {
            patchCalled = true;
          }
          return Response.json({
            number: 3200,
            state: "open",
            title: "t",
            body: "old body",
            head: { sha: "0000000000000000000000000000000000000000" },
          });
        },
        stderr: (msg) => {
          logs.push(msg);
        },
      },
    );

    expect(mismatchCode).toBe(1);
    expect(patchCalled).toBe(false);
    expect(logs[0]).toContain("does not match local branch");
  });
});
