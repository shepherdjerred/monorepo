import type {
  CommitComparison,
  GitHubClient,
  GitHubReleaseNote,
} from "@shepherdjerred/ops-clients/github.ts";
import type { Fetch } from "@shepherdjerred/ops-clients/http.ts";
import type { RenovateEvidenceSource } from "@shepherdjerred/ops-model/facets.ts";
import { graphemePrefix } from "@shepherdjerred/text";
import {
  resolveUpstreamRegistryInfo,
  type ResolvedRegistryInfo,
  type UpstreamRepoIdentity,
} from "./registry-resolver.ts";
import {
  compareSemver,
  isVersionInDeltaWindow,
  normalizeVersionString,
  parseSemver,
  sanitizeHttpsUrl,
  sanitizeHttpsUrls,
} from "./semver-utils.ts";
import type { ResolvedRenovateCandidate } from "./version-resolver.ts";

export const MAX_CACHE_MISSES_PER_RUN = 30;
export const CHANGELOG_CONCURRENCY = 4;
export const MAX_EVIDENCE_CHARS = 6000;

export type ChangelogEvidence = {
  readonly evidenceSource: RenovateEvidenceSource;
  readonly text: string;
  readonly compareUrl: string | undefined;
  readonly releaseUrls: readonly string[];
  readonly intermediateReleaseCount: number | undefined;
};

function filterCumulativeReleases(
  releases: readonly GitHubReleaseNote[],
  effectiveFromVersion: string | null,
  targetVersion: string,
): GitHubReleaseNote[] {
  const targetParsed = parseSemver(targetVersion);
  const allowPrerelease = targetParsed?.prerelease !== undefined;

  const matching = releases.filter((release) => {
    if (!allowPrerelease && release.prerelease) {
      return false;
    }
    return isVersionInDeltaWindow({
      candidateTag: release.tagName,
      effectiveFromVersion,
      targetVersion,
    });
  });

  return matching.toSorted(
    (left, right) => compareSemver(left.tagName, right.tagName) ?? 0,
  );
}

function formatReleasesEvidence(
  releases: readonly GitHubReleaseNote[],
): string {
  const sections: string[] = [];
  for (const release of releases) {
    const body = release.body.trim();
    const hasDistinctName =
      release.name !== "" && release.name !== release.tagName;
    const header = `### ${release.tagName}${hasDistinctName ? ` (${release.name})` : ""}`;
    sections.push(body === "" ? header : `${header}\n${body}`);
  }
  return graphemePrefix(sections.join("\n\n").trim(), MAX_EVIDENCE_CHARS);
}

function tagVariants(version: string): string[] {
  const normalized = normalizeVersionString(version) ?? version.trim();
  return [...new Set([`v${normalized}`, normalized, version.trim()])];
}

async function tryCompareCommits(
  github: Pick<GitHubClient, "compareCommits">,
  repo: UpstreamRepoIdentity,
  effectiveFromVersion: string,
  targetVersion: string,
): Promise<CommitComparison | undefined> {
  const baseTags = tagVariants(effectiveFromVersion);
  const headTags = tagVariants(targetVersion);
  for (const base of baseTags) {
    for (const head of headTags) {
      if (base === head) {
        continue;
      }
      try {
        return await github.compareCommits({
          owner: repo.owner,
          name: repo.name,
          base,
          head,
        });
      } catch {
        // Try next tag format (e.g. `v1.2.3` vs `1.2.3`).
      }
    }
  }
  return undefined;
}

async function resolveCachedRegistry(input: {
  readonly candidate: ResolvedRenovateCandidate;
  readonly registryCache?: Map<string, Promise<ResolvedRegistryInfo>>;
  readonly fetchImpl?: Fetch;
}): Promise<ResolvedRegistryInfo> {
  const cacheKey = `${input.candidate.ecosystem}:${input.candidate.packageName.toLowerCase()}`;
  const existing = input.registryCache?.get(cacheKey);
  if (existing !== undefined) {
    return await existing;
  }
  const created = resolveUpstreamRegistryInfo({
    candidate: input.candidate,
    ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
  });
  input.registryCache?.set(cacheKey, created);
  return await created;
}

async function tryFetchGithubRepoEvidence(input: {
  readonly github: Pick<GitHubClient, "releasesBetween" | "compareCommits">;
  readonly repo: UpstreamRepoIdentity;
  readonly candidate: ResolvedRenovateCandidate;
  readonly prCompareUrl: string | undefined;
}): Promise<ChangelogEvidence | undefined> {
  const releaseEvidence = await tryFetchGithubReleases(input);
  if (releaseEvidence !== undefined) {
    return releaseEvidence;
  }
  if (input.candidate.effectiveFromVersion === null) {
    return undefined;
  }
  const comparison = await tryCompareCommits(
    input.github,
    input.repo,
    input.candidate.effectiveFromVersion,
    input.candidate.targetVersion,
  );
  if (comparison === undefined || comparison.commits.length === 0) {
    return undefined;
  }
  const lines = comparison.commits.slice(0, 40).map((c) => `- ${c.headline}`);
  return {
    evidenceSource: "github-compare",
    text: graphemePrefix(lines.join("\n"), MAX_EVIDENCE_CHARS),
    compareUrl: sanitizeHttpsUrl(comparison.htmlUrl) ?? input.prCompareUrl,
    releaseUrls: sanitizeHttpsUrls(
      input.candidate.parsedPrBody?.releaseUrls ?? [],
    ),
    intermediateReleaseCount: undefined,
  };
}

function buildFallbackEvidence(
  candidate: ResolvedRenovateCandidate,
  registry: ResolvedRegistryInfo,
  prCompareUrl: string | undefined,
): ChangelogEvidence {
  if (candidate.parsedPrBody?.releaseNotesExcerpt !== undefined) {
    return {
      evidenceSource: "pr-body",
      text: graphemePrefix(
        candidate.parsedPrBody.releaseNotesExcerpt,
        MAX_EVIDENCE_CHARS,
      ),
      compareUrl: prCompareUrl,
      releaseUrls: sanitizeHttpsUrls(candidate.parsedPrBody.releaseUrls),
      intermediateReleaseCount: undefined,
    };
  }

  if (registry.metadataSummary !== undefined) {
    return {
      evidenceSource: "registry-metadata",
      text: graphemePrefix(registry.metadataSummary, MAX_EVIDENCE_CHARS),
      compareUrl: prCompareUrl,
      releaseUrls: sanitizeHttpsUrls(
        registry.homepageUrl === undefined ? [] : [registry.homepageUrl],
      ),
      intermediateReleaseCount: undefined,
    };
  }

  return {
    evidenceSource: "none",
    text: "",
    compareUrl: prCompareUrl,
    releaseUrls: [],
    intermediateReleaseCount: undefined,
  };
}

export async function fetchCandidateChangelogEvidence(input: {
  readonly candidate: ResolvedRenovateCandidate;
  readonly github: Pick<GitHubClient, "releasesBetween" | "compareCommits">;
  readonly registryCache?: Map<string, Promise<ResolvedRegistryInfo>>;
  readonly fetchImpl?: Fetch;
}): Promise<ChangelogEvidence> {
  const registry = await resolveCachedRegistry(input);
  const prCompareUrl = sanitizeHttpsUrl(
    input.candidate.parsedPrBody?.changes.find(
      (c) => c.compareUrl !== undefined,
    )?.compareUrl,
  );

  if (registry.githubRepo !== undefined) {
    const repoEvidence = await tryFetchGithubRepoEvidence({
      github: input.github,
      repo: registry.githubRepo,
      candidate: input.candidate,
      prCompareUrl,
    });
    if (repoEvidence !== undefined) {
      return repoEvidence;
    }
  }

  return buildFallbackEvidence(input.candidate, registry, prCompareUrl);
}

async function tryFetchGithubReleases(input: {
  readonly github: Pick<GitHubClient, "releasesBetween">;
  readonly repo: UpstreamRepoIdentity;
  readonly candidate: ResolvedRenovateCandidate;
  readonly prCompareUrl: string | undefined;
}): Promise<ChangelogEvidence | undefined> {
  try {
    const releases = await input.github.releasesBetween({
      owner: input.repo.owner,
      name: input.repo.name,
      maxPages: 2,
    });
    const inWindow = filterCumulativeReleases(
      releases,
      input.candidate.effectiveFromVersion,
      input.candidate.targetVersion,
    );
    if (inWindow.length === 0) {
      return undefined;
    }
    const formatted = formatReleasesEvidence(inWindow);
    if (formatted === "") {
      return undefined;
    }
    return {
      evidenceSource: "github-releases",
      text: formatted,
      compareUrl: input.prCompareUrl,
      releaseUrls: sanitizeHttpsUrls(inWindow.map((r) => r.url)),
      intermediateReleaseCount: inWindow.length,
    };
  } catch {
    return undefined;
  }
}

export async function mapWithBoundedConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }
  const results: R[] = [];
  let cursor = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);

  const runLane = async () => {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      const item = items[idx];
      if (item !== undefined) {
        results[idx] = await worker(item, idx);
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runLane()));
  return results;
}
