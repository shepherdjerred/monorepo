import { Context } from "@temporalio/activity";
import {
  GitHubClient,
  type OpenPullRequest,
  type PullRequestBody,
} from "@shepherdjerred/ops-clients/github.ts";
import type { Fetch } from "@shepherdjerred/ops-clients/http.ts";
import {
  DEPENDENCY_DASHBOARD_TITLE,
  isRenovatePullRequest,
} from "@shepherdjerred/ops-clients/renovate.ts";
import type { RenovateVersionDelta } from "@shepherdjerred/ops-model/facets.ts";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import { createStructuredLogger } from "#observability/logging.ts";
import {
  CHANGELOG_CONCURRENCY,
  fetchCandidateChangelogEvidence,
  mapWithBoundedConcurrency,
  MAX_CACHE_MISSES_PER_RUN,
} from "./changelog-fetcher.ts";
import {
  collectLiveClusterSnapshot,
  createInClusterConnection,
  EMPTY_CLUSTER_SNAPSHOT,
  type LiveClusterSnapshot,
} from "./cluster-versions.ts";
import {
  isRenovateLlmDeltaEnabled,
  synthesizeRenovateVersionDelta,
  type LlmTextGenerator,
} from "./llm-synthesizer.ts";
import type { ResolvedRegistryInfo } from "./registry-resolver.ts";
import {
  EMPTY_REPO_MANIFESTS,
  fetchMainRepoManifests,
  type MainRepoManifests,
} from "./repo-pins.ts";
import {
  createS3RenovateDeltaStore,
  type RenovateDeltaStore,
} from "./s3-cache.ts";
import {
  resolveRenovateCandidates,
  type ResolvedRenovateCandidate,
} from "./version-resolver.ts";

const MONOREPO_OWNER = "shepherdjerred";
const MONOREPO_NAME = "monorepo";
const log = createStructuredLogger("ops.renovate-delta");

export type RenovateDeltaEnrichmentResult =
  | {
      readonly skipped: true;
      readonly reason: string;
    }
  | {
      readonly skipped: false;
      readonly updatedAt: string;
      readonly totalCandidates: number;
      readonly cacheHits: number;
      readonly synthesizedCount: number;
      readonly deferredMisses: number;
      readonly indexedBranches: number;
    };

export type RenovateDeltaDependencies = {
  readonly isFlagEnabled?: () => Promise<boolean>;
  readonly github?: Pick<
    GitHubClient,
    | "openIssueByTitle"
    | "openPullRequests"
    | "pullRequestBody"
    | "releasesBetween"
    | "compareCommits"
  >;
  readonly loadManifests?: () => Promise<MainRepoManifests>;
  readonly loadClusterSnapshot?: () => Promise<LiveClusterSnapshot>;
  readonly store?: RenovateDeltaStore;
  readonly generateLlmText?: LlmTextGenerator;
  readonly fetchImpl?: Fetch;
  readonly now?: () => Date;
  readonly maxMissesPerRun?: number;
};

function safeHeartbeat(payload: Record<string, unknown>): void {
  try {
    Context.current().heartbeat(payload);
  } catch {
    // Unit tests invoke the enrichment pipeline outside a Temporal Activity context.
  }
}

async function fetchOpenRenovatePrBodies(
  github: Pick<GitHubClient, "pullRequestBody">,
  openPullRequests: readonly OpenPullRequest[],
): Promise<Map<number, PullRequestBody>> {
  const renovatePrs = openPullRequests.filter((pr) =>
    isRenovatePullRequest({ branch: pr.branch, authorLogin: pr.author?.login }),
  );
  const entries = await mapWithBoundedConcurrency(
    renovatePrs,
    CHANGELOG_CONCURRENCY,
    async (pr) => {
      try {
        return await github.pullRequestBody(pr.number);
      } catch {
        return;
      }
    },
  );
  const map = new Map<number, PullRequestBody>();
  for (const body of entries) {
    if (body !== undefined) {
      map.set(body.number, body);
    }
  }
  return map;
}

async function defaultLoadClusterSnapshot(): Promise<LiveClusterSnapshot> {
  const connection = createInClusterConnection();
  if (connection === undefined) {
    return EMPTY_CLUSTER_SNAPSHOT;
  }
  try {
    return await collectLiveClusterSnapshot(connection);
  } catch (error: unknown) {
    log(
      "warning",
      "Live cluster version inspection unavailable; continuing with repo pins",
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return EMPTY_CLUSTER_SNAPSHOT;
  }
}

async function defaultLoadManifests(
  token: () => Promise<string>,
): Promise<MainRepoManifests> {
  try {
    return await fetchMainRepoManifests({
      owner: MONOREPO_OWNER,
      name: MONOREPO_NAME,
      token,
    });
  } catch (error: unknown) {
    log(
      "warning",
      "Main branch manifest lookup failed; continuing with PR metadata",
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return EMPTY_REPO_MANIFESTS;
  }
}

async function partitionCachedCandidates(input: {
  readonly candidates: readonly ResolvedRenovateCandidate[];
  readonly existingByBranch: Readonly<Record<string, RenovateVersionDelta>>;
  readonly store: RenovateDeltaStore;
}): Promise<{
  readonly hitsByBranch: Map<string, RenovateVersionDelta>;
  readonly misses: ResolvedRenovateCandidate[];
}> {
  const hitsByBranch = new Map<string, RenovateVersionDelta>();
  const misses: ResolvedRenovateCandidate[] = [];

  const lookupResults = await mapWithBoundedConcurrency(
    input.candidates,
    CHANGELOG_CONCURRENCY,
    async (candidate) => {
      const fromIndex = input.existingByBranch[candidate.branch];
      if (fromIndex?.cacheKey === candidate.cacheKey) {
        return { candidate, cached: fromIndex };
      }
      const fromItemStore = await input.store.getItem(candidate.cacheKey);
      return { candidate, cached: fromItemStore };
    },
  );

  for (const { candidate, cached } of lookupResults) {
    if (cached === undefined) {
      misses.push(candidate);
    } else {
      hitsByBranch.set(candidate.branch, cached);
    }
  }
  return { hitsByBranch, misses };
}

export async function runRenovateDeltaEnrichmentPipeline(
  deps: RenovateDeltaDependencies = {},
): Promise<RenovateDeltaEnrichmentResult> {
  safeHeartbeat({ phase: "check-flag" });
  const checkEnabled =
    deps.isFlagEnabled ?? (() => isRenovateLlmDeltaEnabled());
  if (!(await checkEnabled())) {
    log(
      "info",
      "Renovate LLM delta enrichment skipped because feature flag is disabled",
    );
    return { skipped: true, reason: "flag-disabled" };
  }

  let cachedToken: string | undefined;
  const getGithubToken = async (): Promise<string> => {
    if (cachedToken !== undefined) {
      return cachedToken;
    }
    const installation = await createGitHubAppInstallationToken();
    cachedToken = installation.token;
    return cachedToken;
  };

  const github =
    deps.github ??
    new GitHubClient({
      owner: MONOREPO_OWNER,
      name: MONOREPO_NAME,
      token: getGithubToken,
    });
  const store = deps.store ?? createS3RenovateDeltaStore();
  const nowFn = deps.now ?? (() => new Date());

  safeHeartbeat({ phase: "collect-sources" });
  const [dashboard, openPullRequests, manifests, cluster, latestIndex] =
    await Promise.all([
      github.openIssueByTitle(DEPENDENCY_DASHBOARD_TITLE),
      github.openPullRequests(),
      deps.loadManifests === undefined
        ? defaultLoadManifests(getGithubToken)
        : deps.loadManifests(),
      deps.loadClusterSnapshot === undefined
        ? defaultLoadClusterSnapshot()
        : deps.loadClusterSnapshot(),
      store.getLatestIndex(),
    ]);

  safeHeartbeat({ phase: "fetch-open-pr-bodies" });
  const pullRequestBodies = await fetchOpenRenovatePrBodies(
    github,
    openPullRequests,
  );

  const candidates = resolveRenovateCandidates({
    dashboardBody: dashboard.body,
    openPullRequests,
    pullRequestBodies,
    manifests,
    cluster,
  });

  safeHeartbeat({ phase: "check-s3-cache", candidates: candidates.length });
  const existingByBranch = latestIndex?.deltasByBranch ?? {};
  const { hitsByBranch, misses } = await partitionCachedCandidates({
    candidates,
    existingByBranch,
    store,
  });

  const maxMisses = deps.maxMissesPerRun ?? MAX_CACHE_MISSES_PER_RUN;
  const selectedMisses = misses.slice(0, maxMisses);
  const deferredMisses = misses.slice(maxMisses);
  const registryCache = new Map<string, Promise<ResolvedRegistryInfo>>();

  let completedMisses = 0;
  const newlySynthesized = await mapWithBoundedConcurrency(
    selectedMisses,
    CHANGELOG_CONCURRENCY,
    async (candidate) => {
      const evidence = await fetchCandidateChangelogEvidence({
        candidate,
        github,
        registryCache,
        ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
      });
      const delta = await synthesizeRenovateVersionDelta({
        candidate,
        evidence,
        now: nowFn(),
        ...(deps.generateLlmText === undefined
          ? {}
          : { generateLlmText: deps.generateLlmText }),
      });
      await store.putItem(delta);
      completedMisses += 1;
      safeHeartbeat({
        phase: "synthesize-deltas",
        completed: completedMisses,
        total: selectedMisses.length,
        branch: candidate.branch,
      });
      return { branch: candidate.branch, delta };
    },
  );

  const deltasByBranch: Record<string, RenovateVersionDelta> =
    Object.fromEntries(hitsByBranch);
  for (const { branch, delta } of newlySynthesized) {
    deltasByBranch[branch] = delta;
  }
  for (const deferred of deferredMisses) {
    const prior = existingByBranch[deferred.branch];
    if (
      prior?.targetVersion === deferred.targetVersion &&
      prior.effectiveFromVersion === deferred.effectiveFromVersion
    ) {
      deltasByBranch[deferred.branch] = prior;
    }
  }

  const updatedAt = nowFn().toISOString();
  safeHeartbeat({ phase: "write-latest-index" });
  await store.putLatestIndex({ updatedAt, deltasByBranch });

  return {
    skipped: false,
    updatedAt,
    totalCandidates: candidates.length,
    cacheHits: hitsByBranch.size,
    synthesizedCount: newlySynthesized.length,
    deferredMisses: deferredMisses.length,
    indexedBranches: Object.keys(deltasByBranch).length,
  };
}

export async function enrichRenovateVersionDeltas(): Promise<RenovateDeltaEnrichmentResult> {
  return await runRenovateDeltaEnrichmentPipeline();
}

export const renovateDeltaActivities = {
  enrichRenovateVersionDeltas,
};

export type RenovateDeltaActivities = typeof renovateDeltaActivities;
