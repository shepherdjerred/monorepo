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
  readonly excludedPaths: readonly string[];
};

export type ReleasePleaseRunnerResult = {
  readonly phase: ReleasePleasePhase;
  readonly count: number;
};

type ReleaseConfig = {
  excludePaths?: string[];
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
    // release-please's CommitExclude treats a path as a directory prefix, so
    // this excludes every changed file below the component path.
    config.excludePaths = [...new Set([...(config.excludePaths ?? []), path])];
  }
}

function applyExcludedPaths(
  manifest: ManifestType,
  excludedPaths: readonly string[],
): void {
  applyExcludedPathsToConfig(manifest.repositoryConfig, excludedPaths);
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
): Promise<ManifestType> {
  const repository = repositoryParts(options.repoUrl);
  const github = await GitHub.create({
    ...repository,
    token: options.token,
    defaultBranch: options.targetBranch,
  });
  const manifest = await Manifest.fromManifest(
    github,
    options.targetBranch,
    "release-please-config.json",
    ".release-please-manifest.json",
  );
  applyExcludedPaths(manifest, options.excludedPaths);
  return manifest;
}

export async function runReleasePlease(
  options: ReleasePleaseRunnerOptions,
): Promise<ReleasePleaseRunnerResult> {
  const manifest = await createManifest(options);
  if (options.phase === "release-pr") {
    const pullRequests = await manifest.createPullRequests();
    return { phase: options.phase, count: pullRequests.filter(Boolean).length };
  }

  const candidates = await manifest.buildReleases();
  validateReleaseCandidatePaths(
    candidates.map((candidate) => candidate.path),
    options.excludedPaths,
  );
  const releases = await manifest.createReleases();
  return { phase: options.phase, count: releases.filter(Boolean).length };
}
