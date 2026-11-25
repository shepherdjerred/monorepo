import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod/v4";
import { register } from "#observability/metrics.ts";
import {
  gitBackupDurationSeconds,
  gitBackupLastSuccessTimestampSeconds,
  gitBackupReposDiscovered,
  gitBackupRepoSuccess,
} from "#observability/metrics-ops-schedules.ts";
import {
  encodeGitHubBasicCredential,
  runGitSubprocess,
  withGitAuthEnvironment,
  type GitSubprocessHooks,
} from "./git-backup-git.ts";
import { discoverGitHubRepositories } from "./git-backup-github.ts";
import {
  buildGitBackupReport,
  GIT_BACKUP_CONFIG,
} from "./git-backup-report.ts";
import {
  GitBackupLatestManifestSchema,
  type GitBackupLatestManifest,
  type GitBackupObjectStore,
} from "./git-backup-store.ts";
import { runGitBackupWithDependencies } from "./git-backup.ts";

const tempDirs: string[] = [];
const recordedHeartbeats: Record<string, unknown>[] = [];

const noopHooks: GitSubprocessHooks = {
  heartbeat: (detail) => {
    recordedHeartbeats.push(detail);
  },
};

function fakeAlphaGitHubFetch(url: string): Promise<Response> {
  const parsed = new URL(url);
  if (parsed.pathname === "/repos/shepherdjerred/alpha/issues") {
    const page = parsed.searchParams.get("page") ?? "1";
    if (page === "1") {
      return Promise.resolve(
        Response.json(
          [{ id: 1, number: 1, title: "First issue", state: "open" }],
          {
            headers: {
              link: '<https://api.github.com/repos/shepherdjerred/alpha/issues?page=2>; rel="next"',
            },
          },
        ),
      );
    }
    return Promise.resolve(
      Response.json([
        { id: 2, number: 2, title: "Second issue", state: "closed" },
      ]),
    );
  }
  if (parsed.pathname === "/repos/shepherdjerred/alpha/issues/comments") {
    return Promise.resolve(
      Response.json([
        {
          id: 10,
          issue_url:
            "https://api.github.com/repos/shepherdjerred/alpha/issues/1",
          body: "Looks great",
        },
      ]),
    );
  }
  return Promise.resolve(new Response("not found", { status: 404 }));
}

const IssuesArchiveSchema = z.object({
  issues: z.array(z.unknown()),
  comments: z.array(z.unknown()),
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function execGit(args: readonly string[], cwd?: string): void {
  const proc = Bun.spawnSync(["git", ...args], {
    ...(cwd === undefined ? {} : { cwd }),
    env: {
      ...Bun.env,
      GIT_AUTHOR_NAME: "Test User",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test User",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (${String(proc.exitCode)}): ${proc.stderr.toString()}`,
    );
  }
}

async function createUpstreamBareRepoWithCommit(
  rootDir: string,
  name: string,
  files: Record<string, string>,
): Promise<{ bareDir: string; workDir: string }> {
  const bareDir = path.join(rootDir, "upstreams", `${name}.git`);
  const workDir = path.join(rootDir, "worktrees", name);
  await Bun.$`mkdir -p ${bareDir} ${workDir}`.quiet();
  execGit(["init", "--bare", "--initial-branch=main", bareDir]);
  execGit(["clone", bareDir, workDir]);
  execGit(["checkout", "-b", "main"], workDir);
  for (const [relPath, content] of Object.entries(files)) {
    const target = path.join(workDir, relPath);
    await Bun.$`mkdir -p ${path.dirname(target)}`.quiet();
    await writeFile(target, content, "utf8");
  }
  execGit(["add", "."], workDir);
  execGit(["commit", "-m", "Initial commit"], workDir);
  execGit(["push", "-u", "origin", "main"], workDir);
  return { bareDir, workDir };
}

function createInMemoryBackupStore() {
  const objects = new Map<string, Uint8Array>();
  let putCalls = 0;
  const deletedKeys: string[] = [];

  const store: GitBackupObjectStore = {
    readLatest(owner, repo) {
      const raw = objects.get(`${owner}/${repo}/latest.json`);
      return raw === undefined
        ? Promise.resolve(undefined)
        : Promise.resolve(
            GitBackupLatestManifestSchema.parse(
              JSON.parse(Buffer.from(raw).toString("utf8")),
            ),
          );
    },
    writeLatest(manifest: GitBackupLatestManifest) {
      objects.set(
        `${manifest.owner}/${manifest.repo}/latest.json`,
        new Uint8Array(Buffer.from(JSON.stringify(manifest), "utf8")),
      );
      return Promise.resolve();
    },
    async putFile(key, filePath) {
      putCalls += 1;
      const bytes = await readFile(filePath);
      objects.set(key, new Uint8Array(bytes));
    },
    putBytes(key, body) {
      putCalls += 1;
      objects.set(key, new Uint8Array(body));
      return Promise.resolve();
    },
    listKeys(prefix) {
      const matching = [...objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .toSorted();
      return Promise.resolve(matching);
    },
    deleteKeys(keys) {
      for (const key of keys) {
        objects.delete(key);
        deletedKeys.push(key);
      }
      return Promise.resolve();
    },
  };

  return {
    store,
    objects,
    deletedKeys,
    getPutCalls: () => putCalls,
  };
}

function resetGitBackupMetrics(): void {
  gitBackupDurationSeconds.reset();
  gitBackupLastSuccessTimestampSeconds.reset();
  gitBackupReposDiscovered.reset();
  gitBackupRepoSuccess.reset();
}

async function cleanupTempDirs(): Promise<void> {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
}

describe("git-backup mirror, bundle, and retention", () => {
  beforeEach(resetGitBackupMetrics);
  afterEach(cleanupTempDirs);

  test("clones bare mirror, verifies zstd git bundle round-trip, skips unchanged runs, updates incrementally, and handles uninitialized wikis", async () => {
    const root = await makeTempDir("git-backup-e2e-");
    const mirrorRootDir = path.join(root, "mirrors");
    const { bareDir, workDir } = await createUpstreamBareRepoWithCommit(
      root,
      "alpha",
      { "README.md": "# Alpha v1\n" },
    );

    const memoryStore = createInMemoryBackupStore();
    const missingWikiPath = path.join(root, "upstreams", "alpha.wiki.git");

    const discovered = [
      {
        owner: "shepherdjerred",
        name: "alpha",
        fullName: "shepherdjerred/alpha",
        cloneUrl: bareDir,
        wikiCloneUrl: missingWikiPath,
        hasWiki: true,
        hasIssues: true,
        archived: false,
        fork: false,
      },
    ];

    const firstRun = await runGitBackupWithDependencies({
      mirrorRootDir,
      readToken: () => Promise.resolve("ghp_test_super_secret_token_999"),
      store: () => memoryStore.store,
      githubFetch: fakeAlphaGitHubFetch,
      discoverRepositories: () => Promise.resolve(discovered),
      hooks: noopHooks,
      now: () => new Date("2026-11-25T10:00:00.000Z"),
    });

    expect(firstRun.discoveredCount).toBe(1);
    expect(firstRun.snapshottedCount).toBe(1);
    expect(firstRun.unchangedCount).toBe(0);
    expect(firstRun.failedCount).toBe(0);
    const repoOutcome = firstRun.repositories[0];
    expect(repoOutcome).toMatchObject({
      owner: "shepherdjerred",
      name: "alpha",
      status: "snapshotted",
      wikiStatus: "uninitialized",
    });
    if (repoOutcome?.status !== "snapshotted") {
      throw new Error("Expected snapshotted outcome");
    }

    const bundleKey = `shepherdjerred/alpha/snapshots/${repoOutcome.snapshotId}.bundle.zst`;
    const issuesKey = `shepherdjerred/alpha/snapshots/${repoOutcome.snapshotId}.issues.json.zst`;
    const compressedBundle = memoryStore.objects.get(bundleKey);
    if (compressedBundle === undefined) {
      throw new Error("Missing uploaded bundle");
    }
    const rawBundleBytes = zstdDecompressSync(compressedBundle);
    const restoredBundlePath = path.join(root, "restored.bundle");
    const restoredCloneDir = path.join(root, "restored-clone");
    await writeFile(restoredBundlePath, rawBundleBytes);
    execGit([
      "-C",
      path.join(mirrorRootDir, "shepherdjerred", "alpha.git"),
      "bundle",
      "verify",
      restoredBundlePath,
    ]);
    execGit(["clone", restoredBundlePath, restoredCloneDir]);
    expect(
      await readFile(path.join(restoredCloneDir, "README.md"), "utf8"),
    ).toBe("# Alpha v1\n");

    const compressedIssues = memoryStore.objects.get(issuesKey);
    if (compressedIssues === undefined) {
      throw new Error("Missing uploaded issues archive");
    }
    const issuesPayload = IssuesArchiveSchema.parse(
      JSON.parse(zstdDecompressSync(compressedIssues).toString("utf8")),
    );
    expect(issuesPayload.issues).toHaveLength(2);
    expect(issuesPayload.comments).toHaveLength(1);

    const putCallsAfterFirst = memoryStore.getPutCalls();
    const secondRun = await runGitBackupWithDependencies({
      mirrorRootDir,
      readToken: () => Promise.resolve("ghp_test_super_secret_token_999"),
      store: () => memoryStore.store,
      githubFetch: fakeAlphaGitHubFetch,
      discoverRepositories: () => Promise.resolve(discovered),
      hooks: noopHooks,
      now: () => new Date("2026-11-26T10:00:00.000Z"),
    });

    expect(secondRun.snapshottedCount).toBe(0);
    expect(secondRun.unchangedCount).toBe(1);
    expect(memoryStore.getPutCalls()).toBe(putCallsAfterFirst);

    await writeFile(path.join(workDir, "README.md"), "# Alpha v2\n", "utf8");
    execGit(["add", "README.md"], workDir);
    execGit(["commit", "-m", "Second commit"], workDir);
    execGit(["push", "origin", "main"], workDir);

    const thirdRun = await runGitBackupWithDependencies({
      mirrorRootDir,
      readToken: () => Promise.resolve("ghp_test_super_secret_token_999"),
      store: () => memoryStore.store,
      githubFetch: fakeAlphaGitHubFetch,
      discoverRepositories: () => Promise.resolve(discovered),
      hooks: noopHooks,
      now: () => new Date("2026-11-27T10:00:00.000Z"),
    });

    expect(thirdRun.snapshottedCount).toBe(1);
    expect(thirdRun.unchangedCount).toBe(0);
    const report = buildGitBackupReport(thirdRun);
    expect(report.verdict).toBe("clear");
    expect(report.execution).toBe("complete");

    const metricsText = await register.metrics();
    expect(metricsText).toContain(
      'git_backup_repos_discovered{component="temporal-worker"} 1',
    );
    expect(metricsText).toContain(
      'git_backup_repo_success{owner="shepherdjerred",repository="alpha",component="temporal-worker"} 1',
    );
  });

  test("prunes snapshot pairs older than keep = 10 while retaining the newest 10", async () => {
    const root = await makeTempDir("git-backup-prune-");
    const mirrorRootDir = path.join(root, "mirrors");
    const { bareDir } = await createUpstreamBareRepoWithCommit(root, "beta", {
      "file.txt": "hello\n",
    });

    const memoryStore = createInMemoryBackupStore();
    for (let day = 1; day <= 11; day++) {
      const dd = String(day).padStart(2, "0");
      const snapId = `2026-10-${dd}-${String(day).padStart(12, "0")}`;
      memoryStore.objects.set(
        `shepherdjerred/beta/snapshots/${snapId}.bundle.zst`,
        new Uint8Array([1]),
      );
      memoryStore.objects.set(
        `shepherdjerred/beta/snapshots/${snapId}.issues.json.zst`,
        new Uint8Array([2]),
      );
    }

    const run = await runGitBackupWithDependencies({
      mirrorRootDir,
      readToken: () => Promise.resolve("ghp_test_token"),
      store: () => memoryStore.store,
      fetchIssuesArchive: () =>
        Promise.resolve({ compressed: new Uint8Array([3]), issueCount: 0 }),
      discoverRepositories: () =>
        Promise.resolve([
          {
            owner: "shepherdjerred",
            name: "beta",
            fullName: "shepherdjerred/beta",
            cloneUrl: bareDir,
            hasWiki: false,
            hasIssues: false,
            archived: false,
            fork: false,
          },
        ]),
      hooks: noopHooks,
      now: () => new Date("2026-11-25T10:00:00.000Z"),
    });

    expect(run.prunedKeysCount).toBe(4);
    expect(memoryStore.deletedKeys).toEqual([
      "shepherdjerred/beta/snapshots/2026-10-01-000000000001.bundle.zst",
      "shepherdjerred/beta/snapshots/2026-10-01-000000000001.issues.json.zst",
      "shepherdjerred/beta/snapshots/2026-10-02-000000000002.bundle.zst",
      "shepherdjerred/beta/snapshots/2026-10-02-000000000002.issues.json.zst",
    ]);
    const remainingSnapshotKeys = [...memoryStore.objects.keys()].filter((k) =>
      k.includes("/snapshots/"),
    );
    expect(remainingSnapshotKeys).toHaveLength(20);
  });
});

describe("git-backup discovery and credential hygiene", () => {
  beforeEach(resetGitBackupMetrics);
  afterEach(cleanupTempDirs);

  test("excludes tabdance while including archived and fork repos across user and orgs", async () => {
    const requestedPaths: string[] = [];
    const discovered = await discoverGitHubRepositories({
      config: GIT_BACKUP_CONFIG,
      token: "ghp_secret",
      secrets: ["ghp_secret"],
      hooks: noopHooks,
      fetchImpl: (url) => {
        const parsed = new URL(url);
        requestedPaths.push(parsed.pathname);
        if (parsed.pathname === "/user/repos") {
          return Promise.resolve(
            Response.json([
              {
                name: "monorepo",
                full_name: "shepherdjerred/monorepo",
                clone_url: "https://github.com/shepherdjerred/monorepo.git",
                has_wiki: true,
                has_issues: true,
                archived: false,
                fork: false,
                owner: { login: "shepherdjerred" },
              },
              {
                name: "tabdance",
                full_name: "tab-dance/tabdance",
                clone_url: "https://github.com/tab-dance/tabdance.git",
                has_wiki: false,
                has_issues: true,
                archived: false,
                fork: false,
                owner: { login: "tab-dance" },
              },
              {
                name: "old-fork",
                full_name: "shepherdjerred/old-fork",
                clone_url: "https://github.com/shepherdjerred/old-fork.git",
                has_wiki: false,
                has_issues: false,
                archived: true,
                fork: true,
                owner: { login: "shepherdjerred" },
              },
            ]),
          );
        }
        if (parsed.pathname === "/orgs/the-storm-mc/repos") {
          return Promise.resolve(
            Response.json([
              {
                name: "storm-plugin",
                full_name: "the-storm-mc/storm-plugin",
                clone_url: "https://github.com/the-storm-mc/storm-plugin.git",
                has_wiki: false,
                has_issues: true,
                archived: false,
                fork: false,
                owner: { login: "the-storm-mc" },
              },
            ]),
          );
        }
        return Promise.resolve(Response.json([]));
      },
    });

    expect(discovered.map((repo) => repo.fullName)).toEqual([
      "shepherdjerred/monorepo",
      "shepherdjerred/old-fork",
      "the-storm-mc/storm-plugin",
    ]);
    expect(requestedPaths).toContain("/orgs/Code-Craft-Crew/repos");
    expect(requestedPaths).toContain("/orgs/sj-omscs/repos");
  });

  test("writes 0600 GIT_CONFIG_GLOBAL, rejects embedded credential args, and redacts token everywhere", async () => {
    const secretToken = "ghp_UltraSecretTokenValue42";
    const expectedBase64 = encodeGitHubBasicCredential(secretToken);

    let configPathAfterCleanup = "";
    await withGitAuthEnvironment(secretToken, async (auth) => {
      const configPath = auth.env["GIT_CONFIG_GLOBAL"];
      if (configPath === undefined) {
        throw new Error("Missing GIT_CONFIG_GLOBAL");
      }
      configPathAfterCleanup = configPath;

      const fileStat = await stat(configPath);
      expect(fileStat.mode & 0o777).toBe(0o600);
      const content = await readFile(configPath, "utf8");
      expect(content).toContain(`Authorization: Basic ${expectedBase64}`);

      await expect(
        runGitSubprocess({
          args: ["clone", `https://${secretToken}@github.com/org/repo.git`],
          auth,
          hooks: noopHooks,
          stepLabel: "bad-url",
        }),
      ).rejects.toThrow("Refusing to invoke git with embedded URL credentials");

      await expect(
        runGitSubprocess({
          args: ["config", "--global", "user.password", secretToken],
          auth,
          hooks: noopHooks,
          stepLabel: "bad-arg",
        }),
      ).rejects.toThrow("Refusing to pass secret material");
    });

    await expect(stat(configPathAfterCleanup)).rejects.toThrow();

    const memoryStore = createInMemoryBackupStore();
    const failedRun = await runGitBackupWithDependencies({
      mirrorRootDir: await makeTempDir("git-backup-redact-"),
      readToken: () => Promise.resolve(secretToken),
      store: () => memoryStore.store,
      discoverRepositories: () =>
        Promise.resolve([
          {
            owner: "shepherdjerred",
            name: "broken",
            fullName: "shepherdjerred/broken",
            cloneUrl: "/nonexistent/path/that/fails.git",
            hasWiki: false,
            hasIssues: true,
            archived: false,
            fork: false,
          },
        ]),
      hooks: noopHooks,
      now: () => new Date("2026-11-25T10:00:00.000Z"),
    });

    expect(failedRun.failedCount).toBe(1);
    expect(JSON.stringify(failedRun)).not.toContain(secretToken);
    expect(JSON.stringify(failedRun)).not.toContain(expectedBase64);

    await expect(
      runGitBackupWithDependencies({
        mirrorRootDir: await makeTempDir("git-backup-api-redact-"),
        readToken: () => Promise.resolve(secretToken),
        store: () => memoryStore.store,
        githubFetch: () =>
          Promise.resolve(
            new Response(
              `Bad credentials: ${secretToken} / ${expectedBase64}`,
              {
                status: 401,
              },
            ),
          ),
        hooks: noopHooks,
        now: () => new Date("2026-11-25T10:00:00.000Z"),
      }),
    ).rejects.toThrow("Bad credentials: <redacted> / <redacted>");
  });
});
