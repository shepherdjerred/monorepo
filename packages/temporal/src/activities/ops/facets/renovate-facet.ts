import {
  GetObjectCommand,
  NoSuchKey,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { z } from "zod";
import type {
  IssueBody,
  MergedPullRequest,
  OpenPullRequest,
} from "@shepherdjerred/ops-clients/github.ts";
import {
  isRenovatePullRequest,
  parseDependencyDashboard,
  type RenovateDeprecation as ParsedDeprecation,
  type RenovateUpdate,
} from "@shepherdjerred/ops-clients/renovate.ts";
import {
  extractPackageAndVersion,
  inferEcosystem,
  inferUpdateType,
} from "@shepherdjerred/ops-clients/renovate-helpers.ts";
import {
  RenovateVersionDeltaSchema,
  type RenovateFacet,
  type RenovateItem,
  type RenovateUpdateState,
  type RenovateVersionDelta,
} from "@shepherdjerred/ops-model/facets.ts";
import { daysBefore } from "#activities/ops/ops-types.ts";
import { normalizeVersionString } from "#activities/ops/renovate-delta/semver-utils.ts";

export const RENOVATE_DELTA_INDEX_KEY = "renovate-deltas/v1/latest-index.json";

const RawDeltaIndexSchema = z.object({
  updatedAt: z.iso.datetime().optional(),
  deltasByBranch: z.record(z.string(), RenovateVersionDeltaSchema),
});

export type RenovateDeltaReader = () => Promise<
  Readonly<Record<string, RenovateVersionDelta>>
>;

export type S3DeltaClient = {
  readonly send: (
    command: GetObjectCommand,
    options?: { readonly abortSignal?: AbortSignal },
  ) => Promise<{
    readonly Body?:
      { readonly transformToString: () => Promise<string> } | undefined;
  }>;
};

function isS3NotFound(error: unknown): boolean {
  return (
    error instanceof NoSuchKey ||
    (error instanceof S3ServiceException &&
      error.$metadata.httpStatusCode === 404)
  );
}

/** Parse and validate raw JSON from `latest-index.json`, failing loudly on malformed entries. */
export function parseRenovateDeltaIndex(
  rawText: string,
): Record<string, RenovateVersionDelta> {
  const parsed: unknown = JSON.parse(rawText);
  return RawDeltaIndexSchema.parse(parsed).deltasByBranch;
}

/**
 * Read `s3://<bucket>/renovate-deltas/v1/latest-index.json`, returning `{}`
 * when S3 credentials are absent or the index object does not exist (404),
 * and surfacing transport or schema errors loudly.
 */
export async function readLatestRenovateDeltas(
  s3Client?: S3DeltaClient,
): Promise<Readonly<Record<string, RenovateVersionDelta>>> {
  const bucket = Bun.env["REPORT_RECEIPT_BUCKET"] ?? "llm-archive";
  let client: S3DeltaClient | undefined = s3Client;
  if (client === undefined) {
    const endpoint = Bun.env["S3_ENDPOINT"];
    const accessKeyId = Bun.env["AWS_ACCESS_KEY_ID"];
    const secretAccessKey = Bun.env["AWS_SECRET_ACCESS_KEY"];
    if (
      endpoint === undefined ||
      endpoint === "" ||
      accessKeyId === undefined ||
      accessKeyId === "" ||
      secretAccessKey === undefined ||
      secretAccessKey === ""
    ) {
      return {};
    }
    const sessionToken = Bun.env["AWS_SESSION_TOKEN"];
    client = new S3Client({
      endpoint,
      region: Bun.env["S3_REGION"] ?? "us-east-1",
      forcePathStyle: (Bun.env["S3_FORCE_PATH_STYLE"] ?? "true") === "true",
      credentials:
        sessionToken === undefined || sessionToken === ""
          ? { accessKeyId, secretAccessKey }
          : { accessKeyId, secretAccessKey, sessionToken },
    });
  }
  let rawBody: string | undefined;
  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: RENOVATE_DELTA_INDEX_KEY,
      }),
      { abortSignal: AbortSignal.timeout(10_000) },
    );
    rawBody =
      response.Body === undefined
        ? undefined
        : await response.Body.transformToString();
  } catch (error: unknown) {
    if (isS3NotFound(error)) {
      return {};
    }
    throw error;
  }
  if (rawBody === undefined) {
    throw new Error(
      `S3 object s3://${bucket}/${RENOVATE_DELTA_INDEX_KEY} returned an empty body`,
    );
  }
  return parseRenovateDeltaIndex(rawBody);
}

function isHalfUpgrade(pr: OpenPullRequest): boolean {
  return (
    pr.labels.some((label) => /half[- ]upgrade/iu.test(label)) ||
    /half[- ]upgrade/iu.test(pr.title)
  );
}

function openPrState(pr: OpenPullRequest): RenovateUpdateState {
  if (pr.mergeable === "CONFLICTING") {
    return "edited-blocked";
  }
  if (pr.checks === "FAILURE" || pr.checks === "ERROR") {
    return "errored";
  }
  return pr.checks === "PENDING" || pr.checks === "EXPECTED"
    ? "pending-checks"
    : "awaiting-approval";
}

function prFields(pr: OpenPullRequest | undefined): Partial<RenovateItem> {
  if (pr === undefined) {
    return {};
  }
  return {
    prNumber: pr.number,
    prUrl: pr.url,
    checks: pr.checks,
    exactHeadApproved: pr.exactHeadApproved,
    mergeable: pr.mergeable,
    halfUpgrade: isHalfUpgrade(pr),
  };
}

function resolveAuthoritativeTarget(
  rawTargetVersion: string | undefined,
): string | null {
  return rawTargetVersion === undefined
    ? null
    : (normalizeVersionString(rawTargetVersion) ?? rawTargetVersion);
}

function matchDeltaForTarget(
  delta: RenovateVersionDelta | undefined,
  currentTargetVersion: string | null,
): RenovateVersionDelta | undefined {
  if (delta === undefined || currentTargetVersion === null) {
    return undefined;
  }
  const normalizedDelta = normalizeVersionString(delta.targetVersion);
  const normalizedCurrent = normalizeVersionString(currentTargetVersion);
  const matches =
    normalizedDelta === null || normalizedCurrent === null
      ? delta.targetVersion.trim() === currentTargetVersion.trim()
      : normalizedDelta === normalizedCurrent;
  return matches ? delta : undefined;
}

function buildDashboardItem(
  update: RenovateUpdate,
  pr: OpenPullRequest | undefined,
  delta: RenovateVersionDelta | undefined,
): RenovateItem {
  const ecosystem = update.ecosystem ?? "unknown";
  const targetVersion = resolveAuthoritativeTarget(update.targetVersion);
  const matchedDelta = matchDeltaForTarget(delta, targetVersion);
  return {
    id: `${update.state}:${update.branch}`,
    branch: update.branch,
    title: update.title,
    packageName: update.packageName ?? update.branch,
    ...(update.ecosystem === undefined ? {} : { datasource: update.ecosystem }),
    ecosystem,
    updateType: update.updateType,
    state: update.state,
    checked: update.checked,
    ...prFields(pr),
    runningVersion: matchedDelta?.runningVersion ?? null,
    pinnedVersion: matchedDelta?.pinnedVersion ?? null,
    targetVersion,
    consumers: [],
    ...(matchedDelta === undefined ? {} : { delta: matchedDelta }),
  };
}

function buildStandalonePrItem(
  pr: OpenPullRequest,
  delta: RenovateVersionDelta | undefined,
): RenovateItem {
  const extracted = extractPackageAndVersion(pr.title);
  const ecosystem =
    inferEcosystem(pr.title, extracted.packageName) ?? "unknown";
  const updateType = inferUpdateType(
    pr.title,
    pr.branch,
    extracted.targetVersion,
  );
  const targetVersion = resolveAuthoritativeTarget(extracted.targetVersion);
  const matchedDelta = matchDeltaForTarget(delta, targetVersion);
  return {
    id: `pr:${String(pr.number)}`,
    branch: pr.branch,
    title: pr.title,
    packageName: extracted.packageName ?? pr.branch,
    ...(ecosystem === "unknown" ? {} : { datasource: ecosystem }),
    ecosystem,
    updateType,
    state: openPrState(pr),
    checked: false,
    ...prFields(pr),
    runningVersion: matchedDelta?.runningVersion ?? null,
    pinnedVersion: matchedDelta?.pinnedVersion ?? null,
    targetVersion,
    consumers: [],
    ...(matchedDelta === undefined ? {} : { delta: matchedDelta }),
  };
}

function mapDeprecation(dep: ParsedDeprecation) {
  const noteParts = [dep.datasource];
  if (dep.replacementAvailable) {
    noteParts.push("replacement PR available");
  }
  return {
    current: dep.packageName,
    replacement: dep.replacement ?? null,
    notes: noteParts.join(" — "),
  };
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  const raw =
    sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? 0) + upper) / 2;
  return Math.round(raw * 100) / 100;
}

export function buildRenovateFacet(input: {
  dashboard: IssueBody | null;
  openPullRequests: readonly OpenPullRequest[];
  merged30d: readonly MergedPullRequest[];
  deltasByBranch?: Readonly<Record<string, RenovateVersionDelta>>;
  now: Date;
}): RenovateFacet {
  const parsed = parseDependencyDashboard(input.dashboard?.body ?? "");
  const deltas = input.deltasByBranch ?? {};
  const renovatePrs = input.openPullRequests.filter((pr) =>
    isRenovatePullRequest({ branch: pr.branch, authorLogin: pr.author?.login }),
  );
  const prByBranch = new Map(renovatePrs.map((pr) => [pr.branch, pr]));
  const coveredBranches = new Set<string>();

  const items: RenovateItem[] = parsed.updates.map((update) => {
    coveredBranches.add(update.branch);
    return buildDashboardItem(
      update,
      prByBranch.get(update.branch),
      deltas[update.branch],
    );
  });

  for (const pr of renovatePrs) {
    if (!coveredBranches.has(pr.branch)) {
      items.push(buildStandalonePrItem(pr, deltas[pr.branch]));
    }
  }

  const ecosystemCounts: Record<string, number> = {};
  const updateTypeCounts: Record<string, number> = {};
  let llmEnrichedCount = 0;
  let llmBreakingCount = 0;

  for (const item of items) {
    ecosystemCounts[item.ecosystem] =
      (ecosystemCounts[item.ecosystem] ?? 0) + 1;
    updateTypeCounts[item.updateType] =
      (updateTypeCounts[item.updateType] ?? 0) + 1;
    if (item.delta !== undefined) {
      llmEnrichedCount += 1;
      if (
        item.delta.impactLevel === "breaking" ||
        item.delta.breakingChanges.length > 0
      ) {
        llmBreakingCount += 1;
      }
    }
  }

  const mergedRenovate30d = input.merged30d
    .filter((pr) =>
      isRenovatePullRequest({
        branch: pr.branch ?? "",
        authorLogin: pr.author?.login,
      }),
    )
    .sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt));

  const weekAgoMs = daysBefore(input.now, 7).getTime();
  const merged7dCount = mergedRenovate30d.filter(
    (pr) => Date.parse(pr.mergedAt) >= weekAgoMs,
  ).length;
  const mergeDurationsHours = mergedRenovate30d
    .map(
      (pr) => (Date.parse(pr.mergedAt) - Date.parse(pr.createdAt)) / 3_600_000,
    )
    .filter((hours) => Number.isFinite(hours) && hours >= 0);

  return {
    issueNumber: input.dashboard?.number ?? null,
    ...(input.dashboard === null ? {} : { issueUrl: input.dashboard.url }),
    truncated: parsed.truncated,
    lookupWarnings: parsed.lookupWarnings,
    deprecations: parsed.deprecations.map((dep) => mapDeprecation(dep)),
    counts: parsed.counts,
    openPrCount: renovatePrs.length,
    prConcurrentLimit: 3,
    merged7dCount,
    merged30dCount: mergedRenovate30d.length,
    medianMergeHours: median(mergeDurationsHours),
    llmEnrichedCount,
    llmBreakingCount,
    ecosystemCounts,
    updateTypeCounts,
    items,
    recentMerged: mergedRenovate30d.slice(0, 20).map((pr) => ({
      number: pr.number,
      title: pr.title,
      url: pr.url,
      mergedAt: pr.mergedAt,
      ...(pr.branch === undefined ? {} : { branch: pr.branch }),
    })),
  };
}
