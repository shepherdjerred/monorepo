import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
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
  assertNoDeleteObjectsErrors,
  createS3GitBackupStore,
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

describe("git-backup wiki and issue incremental snapshots", () => {
  beforeEach(resetGitBackupMetrics);
  afterEach(cleanupTempDirs);

  test("archives wiki mirror bundles and snapshots wiki-only updates while reusing unchanged main bundle", async () => {
    const root = await makeTempDir("git-backup-wiki-");
    const mirrorRootDir = path.join(root, "mirrors");
    const { bareDir } = await createUpstreamBareRepoWithCommit(
      root,
      "wiki-app",
      { "README.md": "# Main repo\n" },
    );
    const wikiRepo = await createUpstreamBareRepoWithCommit(
      root,
      "wiki-app.wiki",
      { "Home.md": "# Wiki v1\n" },
    );

    const memoryStore = createInMemoryBackupStore();
    const discovered = [
      {
        owner: "shepherdjerred",
        name: "wiki-app",
        fullName: "shepherdjerred/wiki-app",
        cloneUrl: bareDir,
        wikiCloneUrl: wikiRepo.bareDir,
        hasWiki: true,
        hasIssues: false,
        archived: false,
        fork: false,
      },
    ];

    const runWikiBackupAt = (iso: string) =>
      runGitBackupWithDependencies({
        mirrorRootDir,
        readToken: () => Promise.resolve("ghp_test_token"),
        store: () => memoryStore.store,
        githubFetch: () => Promise.resolve(Response.json([])),
        discoverRepositories: () => Promise.resolve(discovered),
        hooks: noopHooks,
        now: () => new Date(iso),
      });

    const firstRun = await runWikiBackupAt("2026-11-25T10:00:00.000Z");
    expect(firstRun.snapshottedCount).toBe(1);
    const firstManifest = await memoryStore.store.readLatest(
      "shepherdjerred",
      "wiki-app",
    );
    expect(firstManifest?.wikiStatus).toBe("mirrored");
    expect(firstManifest?.wikiBundleKey).toBe(
      `shepherdjerred/wiki-app/snapshots/${String(firstManifest?.snapshotId)}.wiki.bundle.zst`,
    );

    await writeFile(
      path.join(wikiRepo.workDir, "Home.md"),
      "# Wiki v2\n",
      "utf8",
    );
    execGit(["add", "Home.md"], wikiRepo.workDir);
    execGit(["commit", "-m", "Update wiki home"], wikiRepo.workDir);
    execGit(["push", "origin", "main"], wikiRepo.workDir);

    const secondRun = await runWikiBackupAt("2026-11-25T14:00:00.000Z");
    expect(secondRun.snapshottedCount).toBe(1);
    const secondManifest = await memoryStore.store.readLatest(
      "shepherdjerred",
      "wiki-app",
    );
    expect(secondManifest?.snapshotId).not.toBe(firstManifest?.snapshotId);
    expect(secondManifest?.bundleKey).toBe(firstManifest?.bundleKey);
    expect(secondManifest?.wikiBundleKey).not.toBe(
      firstManifest?.wikiBundleKey,
    );

    const compressedWiki = memoryStore.objects.get(
      secondManifest?.wikiBundleKey ?? "",
    );
    if (compressedWiki === undefined) {
      throw new Error("Missing uploaded wiki bundle");
    }
    const restoredWikiBundle = path.join(root, "restored.wiki.bundle");
    const restoredWikiClone = path.join(root, "restored-wiki");
    await writeFile(restoredWikiBundle, zstdDecompressSync(compressedWiki));
    execGit(["clone", restoredWikiBundle, restoredWikiClone]);
    expect(
      await readFile(path.join(restoredWikiClone, "Home.md"), "utf8"),
    ).toBe("# Wiki v2\n");
  });

  test("refreshes issue archives with immutable snapshot IDs when Git refs are unchanged, protects reused bundleKey during retention, and retries cleanup on unchanged runs", async () => {
    const root = await makeTempDir("git-backup-issues-");
    const mirrorRootDir = path.join(root, "mirrors");
    const { bareDir } = await createUpstreamBareRepoWithCommit(
      root,
      "issues-app",
      { "README.md": "# Stable Git refs\n" },
    );

    let failNextDelete = false;
    const innerStore = createInMemoryBackupStore();
    const storeWithToggle: GitBackupObjectStore = {
      ...innerStore.store,
      async deleteKeys(keys) {
        if (failNextDelete) {
          failNextDelete = false;
          throw new Error("Simulated S3 delete failure");
        }
        await innerStore.store.deleteKeys(keys);
      },
    };

    const discovered = [
      {
        owner: "shepherdjerred",
        name: "issues-app",
        fullName: "shepherdjerred/issues-app",
        cloneUrl: bareDir,
        hasWiki: false,
        hasIssues: true,
        archived: false,
        fork: false,
      },
    ];

    let issueGeneration = 1;
    const runAt = (iso: string) =>
      runGitBackupWithDependencies({
        config: { ...GIT_BACKUP_CONFIG, keepSnapshots: 2 },
        mirrorRootDir,
        readToken: () => Promise.resolve("ghp_test_token"),
        store: () => storeWithToggle,
        discoverRepositories: () => Promise.resolve(discovered),
        githubFetch: (url) => {
          const parsed = new URL(url);
          if (parsed.pathname.endsWith("/issues")) {
            return Promise.resolve(
              Response.json([
                {
                  id: issueGeneration,
                  number: 1,
                  title: `Issue rev ${String(issueGeneration)}`,
                  state: "open",
                },
              ]),
            );
          }
          return Promise.resolve(Response.json([]));
        },
        hooks: noopHooks,
        now: () => new Date(iso),
      });

    const run1 = await runAt("2026-11-25T01:00:00.000Z");
    expect(run1.snapshottedCount).toBe(1);
    const manifest1 = await innerStore.store.readLatest(
      "shepherdjerred",
      "issues-app",
    );
    const originalBundleKey = manifest1?.bundleKey ?? "";
    expect(originalBundleKey).not.toBe("");

    issueGeneration = 2;
    const run2 = await runAt("2026-11-25T02:00:00.000Z");
    expect(run2.snapshottedCount).toBe(1);
    const manifest2 = await innerStore.store.readLatest(
      "shepherdjerred",
      "issues-app",
    );
    expect(manifest2?.snapshotId).not.toBe(manifest1?.snapshotId);
    expect(manifest2?.bundleKey).toBe(originalBundleKey);
    expect(innerStore.objects.has(manifest1?.issuesKey ?? "")).toBe(true);

    // Run 3 creates a 3rd snapshot on the same day with keepSnapshots = 2, and fails deleteKeys after writeLatest.
    issueGeneration = 3;
    failNextDelete = true;
    const run3FailedCleanup = await runAt("2026-11-25T03:00:00.000Z");
    expect(run3FailedCleanup.failedCount).toBe(1);

    // Run 4 has NO changes (issueGeneration still 3, Git refs unchanged): retries retention cleanup!
    const run4Recovered = await runAt("2026-11-25T04:00:00.000Z");
    expect(run4Recovered.unchangedCount).toBe(1);
    expect(run4Recovered.failedCount).toBe(0);
    expect(run4Recovered.prunedKeysCount).toBe(1);
    // Snapshot 1's stale issues archive was pruned, while Snapshot 1's still-referenced bundleKey was protected!
    expect(innerStore.objects.has(manifest1?.issuesKey ?? "")).toBe(false);
    expect(innerStore.objects.has(originalBundleKey)).toBe(true);

    expect(() =>
      assertNoDeleteObjectsErrors([
        {
          Key: "shepherdjerred/issues-app/snapshots/2026-11-25T010000Z-aaaa.issues.json.zst",
          Code: "AccessDenied",
          Message: "Access Denied",
        },
      ]),
    ).toThrow("Failed to delete 1 Git backup snapshot object(s)");
  });
});

describe("git-backup LFS enforcement and offline restoration", () => {
  beforeEach(resetGitBackupMetrics);
  afterEach(cleanupTempDirs);

  test("fails LFS repo when git-lfs is missing and archives + restores LFS objects offline when present", async () => {
    const root = await makeTempDir("git-backup-lfs-");
    const mirrorRootDir = path.join(root, "mirrors");
    const lfsRepo = await createUpstreamBareRepoWithCommit(root, "lfs-repo", {
      ".gitattributes": "*.bin filter=lfs diff=lfs merge=lfs -text\n",
      "asset.bin":
        "version https://git-lfs.github.com/spec/v1\noid sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\nsize 16\n",
    });
    const plainRepo = await createUpstreamBareRepoWithCommit(
      root,
      "plain-repo",
      { "README.md": "# Plain\n" },
    );

    const memoryStore = createInMemoryBackupStore();
    const discovered = [
      {
        owner: "shepherdjerred",
        name: "lfs-repo",
        fullName: "shepherdjerred/lfs-repo",
        cloneUrl: lfsRepo.bareDir,
        hasWiki: false,
        hasIssues: false,
        archived: false,
        fork: false,
      },
      {
        owner: "shepherdjerred",
        name: "plain-repo",
        fullName: "shepherdjerred/plain-repo",
        cloneUrl: plainRepo.bareDir,
        hasWiki: false,
        hasIssues: false,
        archived: false,
        fork: false,
      },
    ];

    const runLfsBackup = (
      repos: typeof discovered,
      lfsPath: string | null,
      iso: string,
    ) =>
      runGitBackupWithDependencies({
        mirrorRootDir,
        readToken: () => Promise.resolve("ghp_test_token"),
        store: () => memoryStore.store,
        githubFetch: () => Promise.resolve(Response.json([])),
        discoverRepositories: () => Promise.resolve(repos),
        resolveLfsBinary: () => lfsPath,
        hooks: noopHooks,
        now: () => new Date(iso),
      });

    const missingLfsRun = await runLfsBackup(
      discovered,
      null,
      "2026-11-25T10:00:00.000Z",
    );
    expect(missingLfsRun.failedCount).toBe(1);
    expect(missingLfsRun.snapshottedCount).toBe(1);
    const failedEntry = missingLfsRun.repositories.find(
      (entry) => entry.name === "lfs-repo",
    );
    expect(failedEntry).toMatchObject({
      status: "failed",
      error: expect.stringContaining("git-lfs is not installed"),
    });

    // Install a fake git-lfs executable that populates lfs/objects during `git lfs fetch --all`.
    const fakeBinDir = path.join(root, "fake-bin");
    const fakeGitLfs = path.join(fakeBinDir, "git-lfs");
    const lfsOid =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    await Bun.$`mkdir -p ${fakeBinDir}`.quiet();
    await writeFile(
      fakeGitLfs,
      `#!/bin/sh\nset -eu\nmkdir -p "lfs/objects/01/23"\nprintf 'BINARY_LFS_BYTES' > "lfs/objects/01/23/${lfsOid}"\n`,
      "utf8",
    );
    await chmod(fakeGitLfs, 0o755);

    const withLfsRun = await runLfsBackup(
      [discovered[0]!],
      fakeGitLfs,
      "2026-11-25T11:00:00.000Z",
    );
    expect(withLfsRun.failedCount).toBe(0);
    expect(withLfsRun.snapshottedCount).toBe(1);

    const manifest = await memoryStore.store.readLatest(
      "shepherdjerred",
      "lfs-repo",
    );
    expect(manifest?.lfsObjectCount).toBe(1);
    expect(manifest?.lfsKey).not.toBeNull();

    // Delete both upstream and mirror cache to prove offline restoration from archived bytes alone.
    await rm(lfsRepo.bareDir, { recursive: true, force: true });
    await rm(lfsRepo.workDir, { recursive: true, force: true });
    await rm(mirrorRootDir, { recursive: true, force: true });

    const bundleBytes = memoryStore.objects.get(manifest?.bundleKey ?? "");
    const lfsTarZstBytes = memoryStore.objects.get(manifest?.lfsKey ?? "");
    if (bundleBytes === undefined || lfsTarZstBytes === undefined) {
      throw new Error("Missing archived bundle or LFS tar");
    }

    const offlineBundlePath = path.join(root, "offline.bundle");
    const offlineLfsTarPath = path.join(root, "offline.lfs.tar");
    const offlineCloneDir = path.join(root, "offline-restored");
    await writeFile(offlineBundlePath, zstdDecompressSync(bundleBytes));
    await writeFile(offlineLfsTarPath, zstdDecompressSync(lfsTarZstBytes));

    execGit(["clone", offlineBundlePath, offlineCloneDir]);
    const tarProc = Bun.spawnSync([
      "tar",
      "-xf",
      offlineLfsTarPath,
      "-C",
      path.join(offlineCloneDir, ".git"),
    ]);
    expect(tarProc.exitCode).toBe(0);

    const restoredLfsPayload = await readFile(
      path.join(offlineCloneDir, ".git", "lfs", "objects", "01", "23", lfsOid),
      "utf8",
    );
    expect(restoredLfsPayload).toBe("BINARY_LFS_BYTES");
  });

  test("streams S3 putFile with exact Content-Length and emits heartbeats during upload", async () => {
    const root = await makeTempDir("git-backup-s3-stream-");
    const samplePath = path.join(root, "sample.bundle.zst");
    const payload = Buffer.alloc(131_072, 0x61);
    await writeFile(samplePath, payload);

    let receivedContentLength: string | null = null;
    let receivedBytes = 0;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        receivedContentLength = req.headers.get("content-length");
        const buf = await req.arrayBuffer();
        receivedBytes = buf.byteLength;
        await Bun.sleep(25);
        return new Response("", {
          status: 200,
          headers: { etag: '"streamed-etag"' },
        });
      },
    });

    try {
      const heartbeats: Record<string, unknown>[] = [];
      const s3Store = createS3GitBackupStore(
        {
          GIT_BACKUP_S3_BUCKET: "git-backups",
          S3_ENDPOINT: `http://127.0.0.1:${String(server.port)}`,
          S3_REGION: "us-east-1",
          AWS_ACCESS_KEY_ID: "test-key",
          AWS_SECRET_ACCESS_KEY: "test-secret",
        },
        {
          heartbeatIntervalMs: 5,
          heartbeat: (detail) => {
            heartbeats.push(detail);
          },
        },
      );

      await s3Store.putFile(
        "shepherdjerred/monorepo/snapshots/test.bundle.zst",
        samplePath,
        "application/zstd",
      );

      expect(receivedContentLength).toBe(String(payload.byteLength));
      expect(receivedBytes).toBe(payload.byteLength);
      expect(
        heartbeats.some(
          (entry) =>
            entry["step"] ===
            "s3-put:shepherdjerred/monorepo/snapshots/test.bundle.zst",
        ),
      ).toBe(true);
    } finally {
      await server.stop(true);
    }
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
