import type {
  OpenPullRequest,
  PullRequestBody,
} from "@shepherdjerred/ops-clients/github.ts";
import {
  isRenovatePullRequest,
  parseDependencyDashboard,
  type RenovateUpdate,
  type RenovateUpdateState,
  type RenovateUpdateType,
} from "@shepherdjerred/ops-clients/renovate.ts";
import {
  extractPackageAndVersion,
  inferEcosystem,
  inferUpdateType,
} from "@shepherdjerred/ops-clients/renovate-helpers.ts";
import {
  resolveRunningVersion,
  type LiveClusterSnapshot,
} from "./cluster-versions.ts";
import {
  parseRenovatePrBody,
  type ParsedRenovatePrBody,
} from "./pr-body-parser.ts";
import {
  lookupRepoPin,
  type MainRepoManifests,
  type RepoPinEntry,
} from "./repo-pins.ts";
import { computeDeltaCacheKey } from "./s3-cache.ts";
import {
  approximateVersionsBehind,
  normalizeVersionString,
} from "./semver-utils.ts";

export type ResolvedRenovateCandidate = {
  readonly branch: string;
  readonly title: string;
  readonly packageName: string;
  readonly targetVersion: string;
  readonly runningVersion: string | null;
  readonly pinnedVersion: string | null;
  readonly effectiveFromVersion: string | null;
  readonly versionsBehindCount: number | null;
  readonly consumers: readonly string[];
  readonly ecosystem: string;
  readonly updateType: RenovateUpdateType;
  readonly state: RenovateUpdateState;
  readonly isOpenPr: boolean;
  readonly prNumber?: number | undefined;
  readonly prUrl?: string | undefined;
  readonly parsedPrBody?: ParsedRenovatePrBody | undefined;
  readonly repoPin?: RepoPinEntry | undefined;
  readonly priorityRank: number;
  readonly cacheKey: string;
};

function priorityRankFor(
  isOpenPr: boolean,
  state: RenovateUpdateState,
): number {
  if (isOpenPr) {
    return 0;
  }
  switch (state) {
    case "awaiting-approval":
      return 1;
    case "errored":
    case "edited-blocked":
      return 2;
    case "rate-limited":
      return 3;
    case "pending-checks":
      return 4;
    case "awaiting-schedule":
      return 5;
    case "ignored":
      return 6;
  }
}

type RawCandidate = {
  readonly branch: string;
  readonly title: string;
  readonly packageName: string | undefined;
  readonly targetVersion: string | undefined;
  readonly ecosystem: string | undefined;
  readonly updateType: RenovateUpdateType;
  readonly state: RenovateUpdateState;
  readonly isOpenPr: boolean;
  readonly prNumber?: number | undefined;
  readonly prUrl?: string | undefined;
};

function rawCandidateFromOpenPr(
  pr: OpenPullRequest,
  dashboardMatch: RenovateUpdate | undefined,
): RawCandidate {
  const extracted = extractPackageAndVersion(pr.title);
  const packageName = extracted.packageName ?? dashboardMatch?.packageName;
  const targetVersion =
    extracted.targetVersion ?? dashboardMatch?.targetVersion;
  return {
    branch: pr.branch,
    title: pr.title,
    packageName,
    targetVersion,
    ecosystem:
      inferEcosystem(pr.title, packageName) ?? dashboardMatch?.ecosystem,
    updateType: inferUpdateType(pr.title, pr.branch, targetVersion),
    state: dashboardMatch?.state ?? "pending-checks",
    isOpenPr: true,
    prNumber: pr.number,
    prUrl: pr.url,
  };
}

function collectRawCandidatesByBranch(
  updates: readonly RenovateUpdate[],
  openPullRequests: readonly OpenPullRequest[],
): Map<string, RawCandidate> {
  const dashboardByBranch = new Map<string, RenovateUpdate>();
  for (const update of updates) {
    if (!dashboardByBranch.has(update.branch)) {
      dashboardByBranch.set(update.branch, update);
    }
  }

  const rawByBranch = new Map<string, RawCandidate>();
  for (const pr of openPullRequests) {
    if (
      isRenovatePullRequest({
        branch: pr.branch,
        authorLogin: pr.author?.login,
      })
    ) {
      rawByBranch.set(
        pr.branch,
        rawCandidateFromOpenPr(pr, dashboardByBranch.get(pr.branch)),
      );
    }
  }

  for (const update of updates) {
    if (!rawByBranch.has(update.branch)) {
      rawByBranch.set(update.branch, {
        branch: update.branch,
        title: update.title,
        packageName: update.packageName,
        targetVersion: update.targetVersion,
        ecosystem: update.ecosystem,
        updateType: update.updateType,
        state: update.state,
        isOpenPr: false,
      });
    }
  }
  return rawByBranch;
}

function selectPackageAndTarget(
  raw: RawCandidate,
  parsedPrBody: ParsedRenovatePrBody | undefined,
):
  | { packageName: string; targetVersion: string; prFromVersion: string | null }
  | undefined {
  const firstPrChange = parsedPrBody?.changes[0];
  const matchedPrChange =
    raw.packageName === undefined
      ? firstPrChange
      : (parsedPrBody?.changes.find(
          (c) => c.packageName.toLowerCase() === raw.packageName?.toLowerCase(),
        ) ?? firstPrChange);

  const packageName = raw.packageName ?? matchedPrChange?.packageName;
  const rawTarget =
    raw.targetVersion ?? matchedPrChange?.toVersion ?? undefined;
  const normalizedTarget =
    normalizeVersionString(rawTarget) ?? rawTarget?.trim();

  if (
    packageName === undefined ||
    packageName === "" ||
    normalizedTarget === undefined ||
    normalizedTarget === ""
  ) {
    return undefined;
  }
  return {
    packageName,
    targetVersion: normalizedTarget,
    prFromVersion: matchedPrChange?.fromVersion ?? null,
  };
}

function mergeConsumers(
  repoPin: RepoPinEntry | undefined,
  parsedPrBody: ParsedRenovatePrBody | undefined,
): string[] {
  return [
    ...new Set([
      ...(repoPin?.consumers ?? []),
      ...(parsedPrBody?.consumers ?? []),
    ]),
  ].toSorted();
}

function resolveSingleCandidate(input: {
  readonly raw: RawCandidate;
  readonly pullRequestBodies: ReadonlyMap<number, PullRequestBody>;
  readonly manifests: MainRepoManifests;
  readonly cluster: LiveClusterSnapshot;
}): ResolvedRenovateCandidate | undefined {
  const { raw } = input;
  const prBodyRecord =
    raw.prNumber === undefined
      ? undefined
      : input.pullRequestBodies.get(raw.prNumber);
  const parsedPrBody =
    prBodyRecord === undefined
      ? undefined
      : parseRenovatePrBody(prBodyRecord.body);

  const selected = selectPackageAndTarget(raw, parsedPrBody);
  if (selected === undefined) {
    return undefined;
  }

  const repoPin = lookupRepoPin(input.manifests, selected.packageName);
  const ecosystem = raw.ecosystem ?? repoPin?.datasource ?? "unknown";
  const runningVersion = resolveRunningVersion({
    packageName: selected.packageName,
    ...(repoPin?.aliases === undefined ? {} : { aliases: repoPin.aliases }),
    ecosystem,
    snapshot: input.cluster,
  });
  const pinnedVersion = repoPin?.pinnedVersion ?? selected.prFromVersion;
  const effectiveFromVersion = runningVersion ?? pinnedVersion;
  const consumers = mergeConsumers(repoPin, parsedPrBody);
  const cacheKey = computeDeltaCacheKey({
    packageName: selected.packageName,
    effectiveFromVersion,
    targetVersion: selected.targetVersion,
    consumers,
  });

  return {
    branch: raw.branch,
    title: raw.title,
    packageName: selected.packageName,
    targetVersion: selected.targetVersion,
    runningVersion,
    pinnedVersion,
    effectiveFromVersion,
    versionsBehindCount: approximateVersionsBehind(
      effectiveFromVersion,
      selected.targetVersion,
    ),
    consumers,
    ecosystem,
    updateType: raw.updateType,
    state: raw.state,
    isOpenPr: raw.isOpenPr,
    prNumber: raw.prNumber,
    prUrl: raw.prUrl,
    parsedPrBody,
    repoPin,
    priorityRank: priorityRankFor(raw.isOpenPr, raw.state),
    cacheKey,
  };
}

export function resolveRenovateCandidates(input: {
  readonly dashboardBody: string;
  readonly openPullRequests: readonly OpenPullRequest[];
  readonly pullRequestBodies: ReadonlyMap<number, PullRequestBody>;
  readonly manifests: MainRepoManifests;
  readonly cluster: LiveClusterSnapshot;
}): ResolvedRenovateCandidate[] {
  const parsedDashboard = parseDependencyDashboard(input.dashboardBody);
  const rawByBranch = collectRawCandidatesByBranch(
    parsedDashboard.updates,
    input.openPullRequests,
  );

  const resolved: ResolvedRenovateCandidate[] = [];
  for (const raw of rawByBranch.values()) {
    const candidate = resolveSingleCandidate({
      raw,
      pullRequestBodies: input.pullRequestBodies,
      manifests: input.manifests,
      cluster: input.cluster,
    });
    if (candidate !== undefined) {
      resolved.push(candidate);
    }
  }

  return resolved.toSorted(
    (left, right) =>
      left.priorityRank - right.priorityRank ||
      left.branch.localeCompare(right.branch),
  );
}
