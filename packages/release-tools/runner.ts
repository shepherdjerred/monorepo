import {
  GitHub,
  Manifest,
  type Manifest as ManifestType,
} from "release-please";

export type ReleasePleasePhase = "release-pr" | "github-release";

export type ReleasePleaseRunnerOptions = {
  readonly phase: ReleasePleasePhase;
  readonly token: string;
  readonly repoUrl: string;
  readonly targetBranch: string;
  readonly targetBranchSha: string;
  readonly excludedPaths: readonly string[];
};

export type ReleasePleaseRunnerResult = {
  readonly phase: ReleasePleasePhase;
  readonly count: number;
};

type ReleaseConfig = {
  excludePaths?: string[];
};

type ReleaseTargetPin = {
  enabled: boolean;
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

function pinGitHubReads(
  github: GitHub,
  targetBranch: string,
  targetBranchSha: string,
): ReleaseTargetPin {
  const pin: ReleaseTargetPin = { enabled: true };
  const pinnedBranch = (branch: string): string =>
    pin.enabled && branch === targetBranch ? targetBranchSha : branch;

  const getFileContentsOnBranch = github.getFileContentsOnBranch.bind(github);
  github.getFileContentsOnBranch = (path, branch) =>
    getFileContentsOnBranch(path, pinnedBranch(branch));

  const findFilesByFilenameAndRef =
    github.findFilesByFilenameAndRef.bind(github);
  github.findFilesByFilenameAndRef = (filename, ref, prefix) =>
    findFilesByFilenameAndRef(filename, pinnedBranch(ref), prefix);

  const findFilesByGlobAndRef = github.findFilesByGlobAndRef.bind(github);
  github.findFilesByGlobAndRef = (glob, ref, prefix) =>
    findFilesByGlobAndRef(glob, pinnedBranch(ref), prefix);

  const findFilesByExtensionAndRef =
    github.findFilesByExtensionAndRef.bind(github);
  github.findFilesByExtensionAndRef = (extension, ref, prefix) =>
    findFilesByExtensionAndRef(extension, pinnedBranch(ref), prefix);

  const mergeCommitIterator = github.mergeCommitIterator.bind(github);
  github.mergeCommitIterator = (branch, options) =>
    mergeCommitIterator(pinnedBranch(branch), options);

  return pin;
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

async function createManifest(
  options: ReleasePleaseRunnerOptions,
): Promise<{ manifest: ManifestType; pin: ReleaseTargetPin }> {
  const repository = repositoryParts(options.repoUrl);
  const github = await GitHub.create({
    ...repository,
    token: options.token,
    defaultBranch: options.targetBranch,
  });
  const pin = pinGitHubReads(
    github,
    options.targetBranch,
    options.targetBranchSha,
  );
  const beforeManifestSha = await branchSha(
    repository,
    options.token,
    options.targetBranch,
  );
  if (beforeManifestSha !== options.targetBranchSha) {
    throw new Error(
      `Release target ${options.targetBranch} moved from ${options.targetBranchSha} ` +
        `to ${beforeManifestSha} before release-please loaded its manifest; retry the release lane`,
    );
  }
  const manifest = await Manifest.fromManifest(
    github,
    options.targetBranch,
    "release-please-config.json",
    ".release-please-manifest.json",
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
  applyExcludedPaths(manifest, options.excludedPaths);
  return { manifest, pin };
}

async function assertTargetBranchSha(
  options: ReleasePleaseRunnerOptions,
): Promise<void> {
  const repository = repositoryParts(options.repoUrl);
  const currentSha = await branchSha(
    repository,
    options.token,
    options.targetBranch,
  );
  if (currentSha !== options.targetBranchSha) {
    throw new Error(
      `Release target ${options.targetBranch} moved from ${options.targetBranchSha} ` +
        `to ${currentSha} during release-please; retry the release lane`,
    );
  }
}

async function createValidatedReleases(
  manifest: ManifestType,
  excludedPaths: readonly string[],
  pin: ReleaseTargetPin,
): Promise<readonly unknown[]> {
  const candidates = await manifest.buildReleases();
  validateReleaseCandidatePaths(
    candidates.map((candidate) => candidate.path),
    excludedPaths,
  );
  pin.enabled = false;

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
  pin: ReleaseTargetPin,
): Promise<readonly unknown[]> {
  const candidates = await manifest.buildPullRequests();
  pin.enabled = false;

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
  const { manifest, pin } = await createManifest(options);
  if (options.phase === "release-pr") {
    await assertTargetBranchSha(options);
    const pullRequests = await createPinnedPullRequests(manifest, pin);
    await assertTargetBranchSha(options);
    return { phase: options.phase, count: pullRequests.filter(Boolean).length };
  }

  await assertTargetBranchSha(options);
  const releases = await createValidatedReleases(
    manifest,
    options.excludedPaths,
    pin,
  );
  await assertTargetBranchSha(options);
  return { phase: options.phase, count: releases.filter(Boolean).length };
}
