import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Context } from "@temporalio/activity";
import { log } from "#observability/log.ts";
import {
  gitBackupDurationSeconds,
  gitBackupLastSuccessTimestampSeconds,
  gitBackupReposDiscovered,
  gitBackupRepoSuccess,
} from "#observability/metrics-ops-schedules.ts";
import {
  redactGitSecrets,
  withGitAuthEnvironment,
  type GitAuthContext,
  type GitSubprocessHooks,
} from "./git-backup-git.ts";
import {
  discoverGitHubRepositories,
  fetchCompressedIssuesArchive,
  type GitHubApiFetch,
} from "./git-backup-github.ts";
import {
  GIT_BACKUP_CONFIG,
  type DiscoveredGitRepository,
  type GitBackupConfig,
  type GitBackupRepoOutcome,
  type GitBackupResult,
} from "./git-backup-report.ts";
import {
  buildSnapshotId,
  isSnapshotStateUnchanged,
  observeRepositoryMirrors,
  pruneExpiredSnapshots,
  resolveSnapshotArtifacts,
} from "./git-backup-snapshot.ts";
import {
  createS3GitBackupStore,
  snapshotObjectKeys,
  type GitBackupLatestManifest,
  type GitBackupObjectStore,
} from "./git-backup-store.ts";

export const DEFAULT_GIT_BACKUP_TOKEN_FILE = "/run/secrets/git-backup/password";
export const DEFAULT_GIT_BACKUP_MIRROR_DIR = "/var/lib/git-backups/mirrors";

type FetchIssuesFn = (args: {
  owner: string;
  repo: string;
  capturedAt: string;
  auth: GitAuthContext;
  hooks: GitSubprocessHooks;
}) => Promise<{
  compressed: Uint8Array;
  issueCount: number;
  contentDigest?: string | undefined;
}>;

export type GitBackupDependencies = {
  readonly config?: GitBackupConfig | undefined;
  readonly mirrorRootDir: string;
  readonly readToken: () => Promise<string>;
  readonly store: () => GitBackupObjectStore;
  readonly githubFetch?: GitHubApiFetch | undefined;
  readonly discoverRepositories?:
    | ((
        auth: GitAuthContext,
        hooks: GitSubprocessHooks,
      ) => Promise<DiscoveredGitRepository[]>)
    | undefined;
  readonly fetchIssuesArchive?: FetchIssuesFn | undefined;
  readonly resolveLfsBinary?: (() => string | null) | undefined;
  readonly hooks: GitSubprocessHooks;
  readonly now: () => Date;
};

async function backupSingleRepository(input: {
  readonly repo: DiscoveredGitRepository;
  readonly config: GitBackupConfig;
  readonly mirrorRootDir: string;
  readonly store: GitBackupObjectStore;
  readonly auth: GitAuthContext;
  readonly hooks: GitSubprocessHooks;
  readonly now: () => Date;
  readonly fetchIssues: FetchIssuesFn;
  readonly resolveLfsBinary?: (() => string | null) | undefined;
}): Promise<Exclude<GitBackupRepoOutcome, { status: "failed" }>> {
  const { repo, config, store, auth, hooks } = input;
  const observation = await observeRepositoryMirrors({
    repo,
    config,
    mirrorRootDir: input.mirrorRootDir,
    auth,
    hooks,
    resolveLfsBinary: input.resolveLfsBinary,
  });

  const capturedAt = input.now().toISOString();
  const issuesArchive = await input.fetchIssues({
    owner: repo.owner,
    repo: repo.name,
    capturedAt,
    auth,
    hooks,
  });
  const issuesDigest =
    issuesArchive.contentDigest ??
    createHash("sha256").update(issuesArchive.compressed).digest("hex");

  const existingLatest = await store.readLatest(repo.owner, repo.name);
  if (
    existingLatest !== undefined &&
    isSnapshotStateUnchanged(existingLatest, observation, issuesDigest)
  ) {
    const prefix = snapshotObjectKeys(
      repo.owner,
      repo.name,
      existingLatest.snapshotId,
    ).prefix;
    const prunedKeysCount = await pruneExpiredSnapshots({
      store,
      prefix,
      keepSnapshots: config.keepSnapshots,
      manifest: existingLatest,
    });
    return {
      owner: repo.owner,
      name: repo.name,
      status: "unchanged",
      refDigest: observation.refDigest,
      refCount: observation.refCount,
      snapshotId: existingLatest.snapshotId,
      prunedKeysCount,
      wikiStatus: observation.wikiStatus,
    };
  }

  const snapshotId = buildSnapshotId(capturedAt, observation, issuesDigest);
  const keys = snapshotObjectKeys(repo.owner, repo.name, snapshotId);
  const scratchDir = await mkdtemp(path.join(tmpdir(), "git-backup-bundle-"));
  let manifest: GitBackupLatestManifest;
  try {
    const artifacts = await resolveSnapshotArtifacts({
      repo,
      snapshotId,
      observation,
      existingLatest,
      store,
      scratchDir,
      auth,
      hooks,
    });
    await store.putBytes(
      keys.issuesKey,
      issuesArchive.compressed,
      "application/zstd",
    );
    manifest = {
      schemaVersion: 1,
      owner: repo.owner,
      repo: repo.name,
      refDigest: observation.refDigest,
      refCount: observation.refCount,
      snapshotId,
      bundleKey: artifacts.bundleKey,
      lfsDigest: observation.lfsInventory.digest,
      lfsKey: artifacts.lfsKey,
      lfsObjectCount: observation.lfsInventory.objectCount,
      wikiRefDigest: observation.wikiRefDigest,
      wikiRefCount: observation.wikiRefCount,
      wikiBundleKey: artifacts.wikiBundleKey,
      issuesKey: keys.issuesKey,
      issuesDigest,
      issueCount: issuesArchive.issueCount,
      wikiStatus: observation.wikiStatus,
      updatedAt: capturedAt,
    };
    await store.writeLatest(manifest);
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }

  const prunedKeysCount = await pruneExpiredSnapshots({
    store,
    prefix: keys.prefix,
    keepSnapshots: config.keepSnapshots,
    manifest,
  });

  return {
    owner: repo.owner,
    name: repo.name,
    status: "snapshotted",
    refDigest: observation.refDigest,
    refCount: observation.refCount,
    snapshotId,
    prunedKeysCount,
    wikiStatus: observation.wikiStatus,
  };
}

async function processRepositoryBatch(input: {
  readonly repositories: readonly DiscoveredGitRepository[];
  readonly config: GitBackupConfig;
  readonly deps: GitBackupDependencies;
  readonly auth: GitAuthContext;
  readonly fetchIssues: FetchIssuesFn;
}): Promise<{
  outcomes: GitBackupRepoOutcome[];
  snapshottedCount: number;
  unchangedCount: number;
  failedCount: number;
  prunedKeysCount: number;
}> {
  const { repositories, config, deps, auth, fetchIssues } = input;
  if (repositories.length === 0) {
    return {
      outcomes: [],
      snapshottedCount: 0,
      unchangedCount: 0,
      failedCount: 0,
      prunedKeysCount: 0,
    };
  }

  const store = deps.store();
  const outcomes: GitBackupRepoOutcome[] = [];
  let snapshottedCount = 0;
  let unchangedCount = 0;
  let failedCount = 0;
  let prunedKeysCount = 0;

  for (const repo of repositories) {
    deps.hooks.cancellationSignal?.throwIfAborted();
    deps.hooks.heartbeat({ repository: repo.fullName });
    try {
      const outcome = await backupSingleRepository({
        repo,
        config,
        mirrorRootDir: deps.mirrorRootDir,
        store,
        auth,
        hooks: deps.hooks,
        now: deps.now,
        fetchIssues,
        resolveLfsBinary: deps.resolveLfsBinary,
      });
      gitBackupRepoSuccess.set({ owner: repo.owner, repository: repo.name }, 1);
      prunedKeysCount += outcome.prunedKeysCount;
      if (outcome.status === "snapshotted") {
        snapshottedCount += 1;
      } else {
        unchangedCount += 1;
      }
      outcomes.push(outcome);
    } catch (repoError: unknown) {
      deps.hooks.cancellationSignal?.throwIfAborted();
      const rawMsg =
        repoError instanceof Error ? repoError.message : String(repoError);
      const redactedMsg = redactGitSecrets(rawMsg, auth.secrets);
      gitBackupRepoSuccess.set({ owner: repo.owner, repository: repo.name }, 0);
      failedCount += 1;
      log("error", "Git backup failed for repository", {
        module: "git-backup",
        repository: repo.fullName,
        error: redactedMsg,
      });
      outcomes.push({
        owner: repo.owner,
        name: repo.name,
        status: "failed",
        error: redactedMsg,
      });
    }
  }

  return {
    outcomes,
    snapshottedCount,
    unchangedCount,
    failedCount,
    prunedKeysCount,
  };
}

function rethrowRedactedBackupError(
  error: unknown,
  secrets: readonly string[],
): never {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const safeMessage = redactGitSecrets(rawMessage, secrets);
  if (safeMessage !== rawMessage) {
    throw new Error(safeMessage);
  }
  throw error;
}

export async function runGitBackupWithDependencies(
  deps: GitBackupDependencies,
): Promise<GitBackupResult> {
  const config = deps.config ?? GIT_BACKUP_CONFIG;
  const startedAt = deps.now().toISOString();
  const wallStartMs = Date.now();
  const rawToken = await deps.readToken();
  const token = rawToken.trim();
  if (token === "") {
    throw new Error("GitHub backup token is empty");
  }

  return withGitAuthEnvironment(token, async (auth) => {
    try {
      const githubFetch: GitHubApiFetch =
        deps.githubFetch ?? ((url, init) => fetch(url, init));
      const repositories =
        deps.discoverRepositories === undefined
          ? await discoverGitHubRepositories({
              config,
              fetchImpl: githubFetch,
              token,
              secrets: auth.secrets,
              hooks: deps.hooks,
            })
          : await deps.discoverRepositories(auth, deps.hooks);

      gitBackupReposDiscovered.set(repositories.length);
      gitBackupRepoSuccess.reset();

      const fetchIssues: FetchIssuesFn =
        deps.fetchIssuesArchive ??
        ((args) =>
          fetchCompressedIssuesArchive({
            owner: args.owner,
            repo: args.repo,
            includeIssues: config.includeIssues,
            capturedAt: args.capturedAt,
            fetchImpl: githubFetch,
            token,
            secrets: args.auth.secrets,
            hooks: args.hooks,
          }));

      const batch = await processRepositoryBatch({
        repositories,
        config,
        deps,
        auth,
        fetchIssues,
      });

      const completedDate = deps.now();
      const durationSeconds = Math.max(0, (Date.now() - wallStartMs) / 1000);
      gitBackupDurationSeconds.observe(durationSeconds);
      if (batch.failedCount === 0 && repositories.length > 0) {
        gitBackupLastSuccessTimestampSeconds.set(
          completedDate.getTime() / 1000,
        );
      }

      return {
        startedAt,
        completedAt: completedDate.toISOString(),
        durationSeconds,
        discoveredCount: repositories.length,
        snapshottedCount: batch.snapshottedCount,
        unchangedCount: batch.unchangedCount,
        failedCount: batch.failedCount,
        prunedKeysCount: batch.prunedKeysCount,
        repositories: batch.outcomes,
      };
    } catch (error: unknown) {
      return rethrowRedactedBackupError(error, auth.secrets);
    }
  });
}

async function readGitHubTokenFromFile(
  env: Readonly<Record<string, string | undefined>> = Bun.env,
): Promise<string> {
  const filePath =
    env["GIT_BACKUP_GITHUB_TOKEN_FILE"]?.trim() ??
    DEFAULT_GIT_BACKUP_TOKEN_FILE;
  if (filePath === "") {
    throw new Error("GIT_BACKUP_GITHUB_TOKEN_FILE must not be empty");
  }
  const rawToken = await Bun.file(filePath).text();
  const token = rawToken.trim();
  if (token === "") {
    throw new Error(`GitHub backup token file at ${filePath} is empty`);
  }
  return token;
}

export async function runGitBackup(): Promise<GitBackupResult> {
  const context = Context.current();
  const mirrorRootDir =
    Bun.env["GIT_BACKUP_MIRROR_DIR"]?.trim() ?? DEFAULT_GIT_BACKUP_MIRROR_DIR;
  const hooks: GitSubprocessHooks = {
    heartbeat: (detail) => {
      context.heartbeat(detail);
    },
    cancellationSignal: context.cancellationSignal,
  };
  return runGitBackupWithDependencies({
    mirrorRootDir,
    readToken: () => readGitHubTokenFromFile(),
    store: () => createS3GitBackupStore(Bun.env, hooks),
    hooks,
    now: () => new Date(),
  });
}

export const gitBackupActivities = {
  runGitBackup,
};

export type GitBackupActivities = typeof gitBackupActivities;
