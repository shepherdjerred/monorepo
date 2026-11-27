import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { landPr, type LandOptions } from "#commands/pr/land.ts";
import {
  checkLocalBranchSync,
  formatMergeStderr,
  preflightGitSpiceLand,
  prepareGitSpiceMerge,
} from "#commands/pr/land-git-spice.ts";
import type { waitForPr } from "#commands/ci.ts";
import { GitHubClient } from "#lib/ci/github.ts";
import { CiObserver } from "#lib/ci/observer.ts";
import { spawnCapture } from "#lib/spawn-capture.ts";
import type { WaitResult } from "#lib/ci/wait/wait.ts";
import { ciFixture, CI_HEAD } from "#test/lib/ci/fixtures.ts";

const MERGE_SHA = "c".repeat(40);
const config = {
  baseUrl: "https://woodpecker.sjer.red",
  token: "test",
  repoId: 1,
};
const options: LandOptions = { json: true, allowRedMain: false };
const noQuota = async () => null;
const observer = () => new CiObserver(new GitHubClient("test"), config);

function ready(): WaitResult {
  return {
    snapshot: ciFixture(),
    verdict: { outcome: "ready", reasons: [], commands: [] },
    elapsedMs: 1,
  };
}

async function runGit(cwd: string, args: readonly string[]): Promise<string> {
  const res = await spawnCapture(["git", ...args], {
    cwd,
    env: {
      ...Bun.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  if (res.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  }
  return res.stdout.trim();
}

async function writeSpiceData(
  cwd: string,
  repo: { trunk: string; remote: string } | null,
  branches: Record<string, unknown>,
): Promise<void> {
  const indexEnv = {
    ...Bun.env,
    GIT_INDEX_FILE: path.join(cwd, ".git", "spice-test-index"),
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
  const addBlob = async (repoPath: string, content: unknown) => {
    const child = Bun.spawn(["git", "hash-object", "-w", "--stdin"], {
      cwd,
      env: indexEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    await child.stdin.write(JSON.stringify(content));
    await child.stdin.end();
    const rawOid = await new Response(child.stdout).text();
    const oid = rawOid.trim();
    await child.exited;
    const upd = await spawnCapture(
      [
        "git",
        "update-index",
        "--add",
        "--cacheinfo",
        `100644,${oid},${repoPath}`,
      ],
      { cwd, env: indexEnv },
    );
    if (upd.exitCode !== 0) throw new Error(upd.stderr);
  };
  if (repo !== null) {
    await addBlob("repo", repo);
  }
  for (const [name, meta] of Object.entries(branches)) {
    await addBlob(`branches/${name}`, meta);
  }
  const treeRes = await spawnCapture(["git", "write-tree"], {
    cwd,
    env: indexEnv,
  });
  const commitRes = await spawnCapture(
    ["git", "commit-tree", treeRes.stdout.trim(), "-m", "spice"],
    { cwd, env: indexEnv },
  );
  await spawnCapture(
    ["git", "update-ref", "refs/spice/data", commitRes.stdout.trim()],
    { cwd, env: indexEnv },
  );
}

function stubPrRead(stubOptions: {
  headRef?: string;
  headSha?: string;
  baseRef?: string;
  merged?: { value: boolean };
}): void {
  const headRef = stubOptions.headRef ?? "feature";
  const headSha = stubOptions.headSha ?? CI_HEAD;
  const baseRef = stubOptions.baseRef ?? "main";
  const merged = stubOptions.merged ?? { value: false };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL) => {
      const url = new URL(input);
      if (!url.pathname.endsWith("/pulls/99")) {
        throw new Error(`Unexpected request ${url.pathname}`);
      }
      const pr = ciFixture().pr;
      return Response.json({
        ...pr,
        merged: merged.value,
        state: merged.value ? "closed" : "open",
        merge_commit_sha: merged.value ? MERGE_SHA : null,
        head: { sha: headSha, ref: headRef },
        base: { sha: pr.base.sha, ref: baseRef },
      });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("missing spice.experiment.merge fails in preflight before waitForPr is called", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "land-preflight-"));
  try {
    await runGit(dir, ["init", "-b", "main"]);
    const wait = vi.fn<typeof waitForPr>(async () => ready());
    const merge = vi.fn();
    await expect(
      landPr(
        {
          number: 99,
          observer: observer(),
          signal: new AbortController().signal,
        },
        options,
        {
          wait,
          merge,
          quota: noQuota,
          preflight: (signal) =>
            preflightGitSpiceLand({
              number: 99,
              observer: observer(),
              signal,
              cwd: dir,
              env: {
                GIT_CONFIG_NOSYSTEM: "1",
                HOME: dir,
                PATH: Bun.env["PATH"],
              },
            }),
        },
      ),
    ).rejects.toThrow("git config --local spice.experiment.merge true");
    expect(wait).not.toHaveBeenCalled();
    expect(merge).not.toHaveBeenCalled();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing local git-spice PR association fails before waitForPr and names track + update-only submit", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "land-assoc-"));
  try {
    await runGit(dir, ["init", "-b", "main"]);
    await runGit(dir, ["config", "--local", "spice.experiment.merge", "true"]);
    await Bun.write(path.join(dir, "a.txt"), "hello\n");
    await runGit(dir, ["add", "a.txt"]);
    await runGit(dir, ["commit", "-m", "init"]);
    const headSha = await runGit(dir, ["rev-parse", "HEAD"]);
    await runGit(dir, ["checkout", "-b", "feature"]);
    await writeSpiceData(
      dir,
      { trunk: "main", remote: "origin" },
      { feature: { base: { name: "main", hash: headSha } } },
    );
    stubPrRead({ headRef: "feature", headSha });

    const wait = vi.fn<typeof waitForPr>(async () => ready());
    await expect(
      landPr(
        {
          number: 99,
          observer: observer(),
          signal: new AbortController().signal,
        },
        options,
        {
          wait,
          merge: vi.fn(),
          quota: noQuota,
          preflight: (signal) =>
            preflightGitSpiceLand({
              number: 99,
              observer: observer(),
              signal,
              cwd: dir,
            }),
        },
      ),
    ).rejects.toThrow(
      "toolkit git-spice branch track --base main feature && toolkit git-spice branch submit --branch feature --update-only --no-prompt",
    );
    expect(wait).not.toHaveBeenCalled();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("diverged local branch reports exact ahead/behind counts and sync command", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "land-diverge-"));
  try {
    await runGit(dir, ["init", "-b", "main"]);
    await Bun.write(path.join(dir, "f.txt"), "base\n");
    await runGit(dir, ["add", "f.txt"]);
    await runGit(dir, ["commit", "-m", "base"]);
    const baseSha = await runGit(dir, ["rev-parse", "HEAD"]);

    await runGit(dir, ["checkout", "-b", "remote-head", baseSha]);
    await Bun.write(path.join(dir, "r1.txt"), "r1\n");
    await runGit(dir, ["add", "r1.txt"]);
    await runGit(dir, ["commit", "-m", "r1"]);
    await Bun.write(path.join(dir, "r2.txt"), "r2\n");
    await runGit(dir, ["add", "r2.txt"]);
    await runGit(dir, ["commit", "-m", "r2"]);
    const remoteSha = await runGit(dir, ["rev-parse", "HEAD"]);

    await runGit(dir, ["checkout", "-b", "feature", baseSha]);
    await Bun.write(path.join(dir, "l1.txt"), "l1\n");
    await runGit(dir, ["add", "l1.txt"]);
    await runGit(dir, ["commit", "-m", "l1"]);

    const sync = await checkLocalBranchSync({
      number: 99,
      branch: "feature",
      expectedHeadSha: remoteSha,
      remote: "origin",
      cwd: dir,
    });
    expect(sync.ok).toBe(false);
    if (!sync.ok) {
      expect(sync.message).toContain("local is 1 ahead, 2 behind");
      expect(sync.message).toContain(
        "git fetch origin && git reset --hard origin/feature",
      );
    }

    const missingBranch = await checkLocalBranchSync({
      number: 99,
      branch: "missing",
      expectedHeadSha: remoteSha,
      remote: "origin",
      cwd: dir,
    });
    expect(missingBranch.ok).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("merge_failed reasons include trimmed git-spice stderr", async () => {
  stubPrRead({});
  const { result } = await landPr(
    {
      number: 99,
      observer: observer(),
      signal: new AbortController().signal,
    },
    options,
    {
      wait: async () => ready(),
      merge: async () => ({
        code: 8,
        stderr:
          '  FTL git-spice: branch "feature" requires selected base "parent"  \n',
      }),
      quota: noQuota,
    },
  );
  expect(result.verdict.outcome).toBe("merge_failed");
  expect(result.verdict.reasons).toContain(
    'FTL git-spice: branch "feature" requires selected base "parent"',
  );
  expect(formatMergeStderr("   \n  ")).toBeNull();
});

async function commitFile(
  dir: string,
  filename: string,
  content: string,
  message: string,
): Promise<string> {
  await Bun.write(path.join(dir, filename), content);
  await runGit(dir, ["add", filename]);
  await runGit(dir, ["commit", "-m", message]);
  return runGit(dir, ["rev-parse", "HEAD"]);
}

async function initStaleChildRepo(
  dir: string,
  repoOptions: { extraChildCommit?: boolean; withPrMetadata?: boolean } = {},
): Promise<string> {
  await runGit(dir, ["init", "-b", "main"]);
  await commitFile(dir, "a.txt", "v1\n", "v1");
  await runGit(dir, ["checkout", "-b", "child"]);
  const childSha =
    repoOptions.extraChildCommit === true
      ? await commitFile(dir, "b.txt", "v2\n", "v2")
      : await runGit(dir, ["rev-parse", "HEAD"]);
  await writeSpiceData(
    dir,
    { trunk: "main", remote: "origin" },
    {
      child: {
        base: { name: "merged-parent", hash: childSha },
        ...(repoOptions.withPrMetadata === true
          ? { change: { github: { pr: { number: 99, gqlID: "PR_kwDO_99" } } } }
          : {}),
      },
    },
  );
  return childSha;
}

test("retargets stale merged parent baseName onto trunk before spawning git-spice branch merge", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "land-retarget-"));
  try {
    const childSha = await initStaleChildRepo(dir, {
      extraChildCommit: true,
      withPrMetadata: true,
    });

    const binDir = path.join(dir, "bin");
    await mkdir(binDir, { recursive: true });
    await Bun.write(
      path.join(binDir, "git-spice"),
      [
        "#!/bin/sh",
        `echo "$@" > "${path.join(dir, "track-args.txt")}"`,
        "exit 0",
      ].join("\n"),
    );
    await chmod(path.join(binDir, "git-spice"), 0o755);

    const merged = { value: false };
    stubPrRead({
      headRef: "child",
      headSha: childSha,
      baseRef: "main",
      merged,
    });
    const snapshot = ciFixture();
    snapshot.pr.head.sha = childSha;
    snapshot.pr.base.ref = "main";
    vi.spyOn(console, "error").mockReturnValue();

    const { result } = await landPr(
      {
        number: 99,
        observer: observer(),
        signal: new AbortController().signal,
      },
      options,
      {
        wait: async () => ({
          snapshot,
          verdict: { outcome: "ready", reasons: [], commands: [] },
          elapsedMs: 1,
        }),
        prepareMerge: (target, signal) =>
          prepareGitSpiceMerge(target, signal, {
            cwd: dir,
            env: { ...Bun.env, PATH: `${binDir}:${Bun.env["PATH"] ?? ""}` },
          }),
        merge: async (branch) => {
          expect(branch).toBe("child");
          merged.value = true;
          return 0;
        },
        quota: noQuota,
      },
    );

    expect(result.verdict.outcome).toBe("merged");
    const rawArgs = await Bun.file(path.join(dir, "track-args.txt")).text();
    const recordedArgs = rawArgs.trim();
    expect(recordedArgs).toContain(
      "branch track --no-prompt --base main child",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("surfaces manual branch track command when stale base retargeting fails", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "land-retarget-fail-"));
  try {
    const childSha = await initStaleChildRepo(dir);

    const prep = await prepareGitSpiceMerge(
      {
        number: 99,
        branch: "child",
        headSha: childSha,
        baseRef: "main",
      },
      new AbortController().signal,
      {
        cwd: dir,
        trackBranch: async () => ({ code: 1, stderr: "track failed" }),
      },
    );
    expect(prep.ok).toBe(false);
    if (!prep.ok) {
      expect(prep.commands).toContain(
        "toolkit git-spice branch track --base main child",
      );
      expect(prep.reasons).toContain("track failed");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("preflight covers uninitialized git-spice, untracked branch, and already-merged PR pass-through", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "land-preflight-extra-"));
  try {
    await runGit(dir, ["init", "-b", "main"]);
    await runGit(dir, ["config", "--local", "spice.experiment.merge", "true"]);
    await expect(
      preflightGitSpiceLand({
        number: 99,
        observer: observer(),
        signal: new AbortController().signal,
        cwd: dir,
      }),
    ).rejects.toThrow("toolkit git-spice repo init");

    await Bun.write(path.join(dir, "a.txt"), "init\n");
    await runGit(dir, ["add", "a.txt"]);
    await runGit(dir, ["commit", "-m", "init"]);
    const headSha = await runGit(dir, ["rev-parse", "HEAD"]);
    await writeSpiceData(dir, { trunk: "main", remote: "origin" }, {});

    stubPrRead({ headRef: "untracked", headSha });
    await expect(
      preflightGitSpiceLand({
        number: 99,
        observer: observer(),
        signal: new AbortController().signal,
        cwd: dir,
      }),
    ).rejects.toThrow("is not tracked by git-spice");

    const merged = { value: true };
    stubPrRead({ headRef: "untracked", headSha, merged });
    await expect(
      preflightGitSpiceLand({
        number: 99,
        observer: observer(),
        signal: new AbortController().signal,
        cwd: dir,
      }),
    ).resolves.toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
