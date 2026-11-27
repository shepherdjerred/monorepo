import { Manifest, type Manifest as ManifestType } from "release-please";
import { LocalGitHub } from "release-please/build/src/local-github.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export type ReleasePleasePhase = "release-pr" | "github-release";

export type ReleasePleaseTarget = {
  readonly targetBranchSha: string;
  readonly excludedPaths: readonly string[];
};

export type ReleasePleaseRunnerOptions = {
  readonly phase: ReleasePleasePhase;
  readonly token: string;
  readonly repoUrl: string;
  readonly targetBranch: string;
  readonly resolveTarget: () => Promise<ReleasePleaseTarget>;
  readonly canUpdateDraft?: () => Promise<boolean>;
  readonly gitRemoteUrl?: string;
};

export type ReleasePleaseRunnerResult = {
  readonly phase: ReleasePleasePhase;
  readonly count: number;
};

type ReleaseConfig = {
  excludePaths?: string[];
};

type CreatedManifest = {
  readonly manifest: ManifestType;
  readonly target: ReleasePleaseTarget;
  readonly cleanup: () => Promise<void>;
};

function repositoryParts(repoUrl: string): {
  readonly owner: string;
  readonly repo: string;
} {
  const url = new URL(repoUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  const owner = parts[0];
  const repoWithSuffix = parts[1];
  if (owner === undefined || repoWithSuffix === undefined) {
    throw new Error(`Could not parse GitHub repository URL: ${repoUrl}`);
  }
  const repo = repoWithSuffix.endsWith(".git")
    ? repoWithSuffix.slice(0, -4)
    : repoWithSuffix;
  if (repo === "")
    throw new Error(`Could not parse GitHub repository URL: ${repoUrl}`);
  return { owner, repo };
}

export function applyExcludedPathsToConfig(
  repositoryConfig: Record<string, ReleaseConfig>,
  excludedPaths: readonly string[],
): void {
  for (const path of excludedPaths) {
    const config = repositoryConfig[path];
    if (config === undefined) {
      throw new Error(
        `Release policy tried to exclude unconfigured package path ${path}`,
      );
    }
    // release-please normalizes this directory prefix before matching changed
    // files, so every descendant of the ineligible component is excluded.
    const descendantPath = `${path}/`;
    config.excludePaths = [
      ...new Set([...(config.excludePaths ?? []), descendantPath]),
    ];
  }
}

function applyExcludedPaths(
  manifest: ManifestType,
  excludedPaths: readonly string[],
): void {
  applyExcludedPathsToConfig(manifest.repositoryConfig, excludedPaths);
}

async function runGit(cwd: string, args: readonly string[]): Promise<void> {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    const detail = stderr.trim();
    throw new Error(
      `git ${args.join(" ")} failed with exit code ${String(exitCode)}${detail === "" ? "" : `: ${detail}`}`,
    );
  }
}

async function pinLocalRepository(
  repositoryPath: string,
  targetBranch: string,
  targetBranchSha: string,
): Promise<void> {
  await runGit(repositoryPath, ["checkout", "--detach", targetBranchSha]);
  await runGit(repositoryPath, [
    "update-ref",
    `refs/heads/${targetBranch}`,
    targetBranchSha,
  ]);
}

async function branchSha(
  repository: { readonly owner: string; readonly repo: string },
  token: string,
  branch: string,
): Promise<string> {
  const response = await fetch(
    `https://api.github.com/repos/${repository.owner}/${repository.repo}/git/ref/heads/${encodeURIComponent(branch)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!response.ok) {
    throw new Error(
      `Could not resolve ${branch} on GitHub (${String(response.status)} ${response.statusText})`,
    );
  }
  const payload: unknown = await response.json();
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new Error(`GitHub returned an invalid ref response for ${branch}`);
  }
  const object = Object.entries(payload).find(([key]) => key === "object")?.[1];
  if (typeof object !== "object" || object === null || Array.isArray(object)) {
    throw new Error(`GitHub returned no commit SHA for ${branch}`);
  }
  const sha = Object.entries(object).find(([key]) => key === "sha")?.[1];
  if (typeof sha !== "string") {
    throw new Error(`GitHub returned no commit SHA for ${branch}`);
  }
  return sha;
}

export function validateReleaseCandidatePaths(
  candidatePaths: readonly string[],
  excludedPaths: readonly string[],
): void {
  const excluded = new Set(excludedPaths);
  const invalid = candidatePaths.filter((path) => excluded.has(path));
  if (invalid.length > 0) {
    throw new Error(
      `Release-please proposed ineligible package(s): ${invalid.join(", ")}. ` +
        "Close the stale release PR and rerun the release lane after reviewing its diff.",
    );
  }
}

function isGitHubRepositoryUrl(repoUrl: string): boolean {
  return new URL(repoUrl).hostname === "github.com";
}

function gitOriginUrl(
  options: ReleasePleaseRunnerOptions,
  repository: { readonly owner: string; readonly repo: string },
): string {
  if (options.gitRemoteUrl !== undefined) {
    return options.gitRemoteUrl;
  }
  if (new URL(options.repoUrl).protocol === "file:") {
    return options.repoUrl;
  }
  return `https://github.com/${repository.owner}/${repository.repo}.git`;
}

/**
 * The only files release-please's clone needs on disk. release-please reads
 * every repository file through Git objects (`git show`, `git ls-tree`,
 * `git log`) and writes through the GitHub API, never from the working tree,
 * so materializing the whole tree only costs writes: about 1.9 GB per run,
 * most of it blobs fetched just to be checked out. Git refuses a checkout that
 * leaves no files, so the two root files that configure release-please stay.
 */
const RELEASE_PLEASE_WORKTREE_PATHS = [
  "release-please-config.json",
  ".release-please-manifest.json",
] as const;

export async function initializePartialClone(
  repositoryPath: string,
  remoteUrl: string,
  targetBranch: string,
): Promise<void> {
  await runGit(repositoryPath, ["init", "--quiet"]);
  await runGit(repositoryPath, ["remote", "add", "origin", remoteUrl]);
  await runGit(repositoryPath, ["config", "remote.origin.promisor", "true"]);
  await runGit(repositoryPath, [
    "config",
    "remote.origin.partialclonefilter",
    "blob:none",
  ]);
  // Set before the first checkout, and inherited by LocalGitHub's own
  // `checkout` and `reset --hard`, so no later step fetches the tree's blobs.
  await runGit(repositoryPath, [
    "sparse-checkout",
    "set",
    "--no-cone",
    ...RELEASE_PLEASE_WORKTREE_PATHS.map((file) => `/${file}`),
  ]);
  await runGit(repositoryPath, [
    "fetch",
    "--filter=blob:none",
    "--no-tags",
    "origin",
    `+refs/heads/${targetBranch}:refs/remotes/origin/${targetBranch}`,
  ]);
  await runGit(repositoryPath, [
    "checkout",
    "-B",
    targetBranch,
    `refs/remotes/origin/${targetBranch}`,
  ]);
}

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const PENDING_RELEASE_LABEL = "autorelease: pending";
const CLOSED_PR_PAGE_SIZE = 100;
// Matches release-please's own Manifest.findMergedReleasePullRequests() scan
// bound (`pullRequestIterator(targetBranch, "MERGED", 200, false)`), which
// counts merged PRs (`merged_at` present) rather than unmerged closed PRs
// while reading GitHub's primary pulls store instead of the Search API.
const MERGED_PR_SCAN_LIMIT = 200;

type ClosedPullRequestInspection = {
  readonly merged: boolean;
  readonly pendingRelease: boolean;
};

function inspectClosedPullRequest(item: unknown): ClosedPullRequestInspection {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    throw new Error(
      "GitHub returned an invalid pull request entry when checking release pull requests",
    );
  }
  const fields = new Map(Object.entries(item));
  const mergedAt = fields.get("merged_at");
  if (mergedAt !== null && typeof mergedAt !== "string") {
    throw new Error(
      "GitHub returned an invalid merged_at field when checking release pull requests",
    );
  }
  const labels = fields.get("labels");
  if (!Array.isArray(labels)) {
    throw new Error(
      "GitHub returned an invalid labels list when checking release pull requests",
    );
  }
  const hasPendingLabel = labels.some((label) => {
    if (typeof label !== "object" || label === null || Array.isArray(label)) {
      throw new Error(
        "GitHub returned an invalid label entry when checking release pull requests",
      );
    }
    const name = new Map(Object.entries(label)).get("name");
    if (typeof name !== "string") {
      throw new Error(
        "GitHub returned a label without a string name when checking release pull requests",
      );
    }
    return name === PENDING_RELEASE_LABEL;
  });
  const merged = typeof mergedAt === "string" && mergedAt !== "";
  return { merged, pendingRelease: merged && hasPendingLabel };
}

function hasMoreClosedPullRequestPages(
  response: Response,
  pageLength: number,
): boolean {
  if (pageLength === 0) {
    return false;
  }
  const linkHeader = response.headers.get("link");
  if (linkHeader !== null) {
    return /<[^<>]+>;\s*rel="next"/i.test(linkHeader);
  }
  return pageLength >= CLOSED_PR_PAGE_SIZE;
}

export async function hasMergedPendingReleasePullRequest(
  repository: { readonly owner: string; readonly repo: string },
  token: string,
  targetBranch: string,
  fetchImpl?: FetchLike,
): Promise<boolean> {
  const fetcher = fetchImpl ?? globalThis.fetch;
  let mergedInspected = 0;
  for (let page = 1; mergedInspected < MERGED_PR_SCAN_LIMIT; page += 1) {
    const response = await fetcher(
      `https://api.github.com/repos/${repository.owner}/${repository.repo}/pulls?state=closed&base=${encodeURIComponent(targetBranch)}&sort=updated&direction=desc&per_page=${String(CLOSED_PR_PAGE_SIZE)}&page=${String(page)}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!response.ok) {
      throw new Error(
        `Could not query merged release pull requests on GitHub (${String(response.status)} ${response.statusText})`,
      );
    }
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error(
        "GitHub returned a non-array pulls response for merged release pull requests",
      );
    }
    for (const item of payload) {
      const inspection = inspectClosedPullRequest(item);
      if (!inspection.merged) {
        continue;
      }
      if (inspection.pendingRelease) {
        return true;
      }
      mergedInspected += 1;
      if (mergedInspected >= MERGED_PR_SCAN_LIMIT) {
        return false;
      }
    }
    if (!hasMoreClosedPullRequestPages(response, payload.length)) {
      return false;
    }
  }
  return false;
}

async function createManifest(
  options: ReleasePleaseRunnerOptions,
  preResolvedTarget?: ReleasePleaseTarget,
): Promise<CreatedManifest> {
  const repository = repositoryParts(options.repoUrl);
  const localRepositoryPath = await mkdtemp(
    path.join(tmpdir(), "release-please-"),
  );
  try {
    await initializePartialClone(
      localRepositoryPath,
      gitOriginUrl(options, repository),
      options.targetBranch,
    );
    const github = await LocalGitHub.create({
      ...repository,
      token: options.token,
      defaultBranch: options.targetBranch,
      localRepoPath: localRepositoryPath,
    });
    // When not pre-resolved (release-pr), bind eligibility and the revision
    // after cloning finishes, then fetch that exact commit if main advanced.
    const target = preResolvedTarget ?? (await options.resolveTarget());
    await runGit(localRepositoryPath, [
      "fetch",
      "--filter=blob:none",
      "--no-tags",
      "origin",
      target.targetBranchSha,
    ]);
    await pinLocalRepository(
      localRepositoryPath,
      options.targetBranch,
      target.targetBranchSha,
    );
    const beforeManifestSha = await branchSha(
      repository,
      options.token,
      options.targetBranch,
    );
    if (beforeManifestSha !== target.targetBranchSha) {
      throw new Error(
        `Release target ${options.targetBranch} moved from ${target.targetBranchSha} ` +
          `to ${beforeManifestSha} before release-please loaded its manifest; retry the release lane`,
      );
    }
    const manifest = await Manifest.fromManifest(
      github,
      options.targetBranch,
      "release-please-config.json",
      ".release-please-manifest.json",
      { draftPullRequest: true },
    );
    const afterManifestSha = await branchSha(
      repository,
      options.token,
      options.targetBranch,
    );
    if (afterManifestSha !== beforeManifestSha) {
      throw new Error(
        `Release target ${options.targetBranch} moved while release-please loaded its manifest ` +
          `(${beforeManifestSha} -> ${afterManifestSha}); retry the release lane`,
      );
    }
    applyExcludedPaths(manifest, target.excludedPaths);
    return {
      manifest,
      target,
      cleanup: () => rm(localRepositoryPath, { force: true, recursive: true }),
    };
  } catch (error) {
    await rm(localRepositoryPath, { force: true, recursive: true });
    throw error;
  }
}

async function assertTargetBranchSha(
  options: ReleasePleaseRunnerOptions,
  targetBranchSha: string,
): Promise<void> {
  const repository = repositoryParts(options.repoUrl);
  const currentSha = await branchSha(
    repository,
    options.token,
    options.targetBranch,
  );
  if (currentSha !== targetBranchSha) {
    throw new Error(
      `Release target ${options.targetBranch} moved from ${targetBranchSha} ` +
        `to ${currentSha} during release-please; retry the release lane`,
    );
  }
}

async function createValidatedReleases(
  manifest: ManifestType,
  excludedPaths: readonly string[],
): Promise<readonly unknown[]> {
  const candidates = await manifest.buildReleases();
  validateReleaseCandidatePaths(
    candidates.map((candidate) => candidate.path),
    excludedPaths,
  );
  // release-please 17.11.1 discovers candidates again inside createReleases.
  // Freeze that public method to the validated set for this call so a stale
  // release PR cannot become publishable between validation and tagging.
  const originalBuildReleases = manifest.buildReleases;
  manifest.buildReleases = async () => candidates;
  try {
    return await manifest.createReleases();
  } finally {
    manifest.buildReleases = originalBuildReleases;
  }
}

async function createPinnedPullRequests(
  manifest: ManifestType,
  canUpdateDraft?: () => Promise<boolean>,
): Promise<readonly unknown[]> {
  const candidates = await manifest.buildPullRequests();
  if (canUpdateDraft !== undefined && !(await canUpdateDraft())) return [];

  const originalBuildPullRequests = manifest.buildPullRequests;
  manifest.buildPullRequests = async () => candidates;
  try {
    return await manifest.createPullRequests();
  } finally {
    manifest.buildPullRequests = originalBuildPullRequests;
  }
}

export async function runReleasePlease(
  options: ReleasePleaseRunnerOptions,
): Promise<ReleasePleaseRunnerResult> {
  if (options.phase === "github-release") {
    const target = await options.resolveTarget();
    await assertTargetBranchSha(options, target.targetBranchSha);
    if (isGitHubRepositoryUrl(options.repoUrl)) {
      const repository = repositoryParts(options.repoUrl);
      const hasPending = await hasMergedPendingReleasePullRequest(
        repository,
        options.token,
        options.targetBranch,
      );
      if (!hasPending) {
        console.log(
          `No merged autorelease: pending pull requests on ${options.targetBranch}; skipping local clone`,
        );
        return { phase: "github-release", count: 0 };
      }
    }
    const created = await createManifest(options, target);
    try {
      await assertTargetBranchSha(options, created.target.targetBranchSha);
      const releases = await createValidatedReleases(
        created.manifest,
        created.target.excludedPaths,
      );
      await assertTargetBranchSha(options, created.target.targetBranchSha);
      return { phase: options.phase, count: releases.filter(Boolean).length };
    } finally {
      await created.cleanup();
    }
  }

  const created = await createManifest(options);
  try {
    await assertTargetBranchSha(options, created.target.targetBranchSha);
    const pullRequests = await createPinnedPullRequests(
      created.manifest,
      options.canUpdateDraft,
    );
    await assertTargetBranchSha(options, created.target.targetBranchSha);
    return {
      phase: options.phase,
      count: pullRequests.filter(Boolean).length,
    };
  } finally {
    await created.cleanup();
  }
}
