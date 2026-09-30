import type {
  Author,
  Commit,
  MergedPullRequest,
  OpenPullRequest,
} from "@shepherdjerred/ops-clients/github.ts";
import { isRenovatePullRequest } from "@shepherdjerred/ops-clients/renovate.ts";
import { METRIC_IDS } from "@shepherdjerred/ops-model/metric-ids.ts";
import { OPS_POLICY } from "@shepherdjerred/ops-model/policy.ts";
import {
  worstSeverity,
  type Severity,
} from "@shepherdjerred/ops-model/severity.ts";
import type {
  ChangeEventInput,
  SignalInput,
} from "@shepherdjerred/ops-model/snapshot.ts";
import {
  daysBefore,
  daysSince,
  metric,
  truncate,
  type OpsCollection,
  type OpsContext,
} from "./ops-types.ts";

/** The repository owner; everything else a human opens is `other`. */
export const OWNER_LOGIN = "shepherdjerred";
/** Machine accounts that open PRs on Jerred's behalf. */
export const AGENT_LOGINS: ReadonlySet<string> = new Set(["derrej"]);

export const AUTHOR_CLASSES = ["me", "agent", "renovate", "other"] as const;
export type AuthorClass = (typeof AUTHOR_CLASSES)[number];

/** Merged PRs and image-pin commits are re-sent as changes this long. */
export const CHANGE_WINDOW_DAYS = 2;
export const VERSION_CATALOG_PATH = "packages/version-catalog/src/catalog.json";

export function authorClass(author: Author, branch: string): AuthorClass {
  if (author === undefined) {
    return "other";
  }
  if (isRenovatePullRequest({ branch, authorLogin: author.login })) {
    return "renovate";
  }
  if (author.login === OWNER_LOGIN) {
    return "me";
  }
  return AGENT_LOGINS.has(author.login) || author.kind === "bot"
    ? "agent"
    : "other";
}

/**
 * An agent PR is waiting on Jerred when it is ready for review: not a draft,
 * green, mergeable, and neither approved nor sent back for changes.
 */
export function awaitsReview(pr: OpenPullRequest): boolean {
  return (
    authorClass(pr.author, pr.branch) === "agent" &&
    !pr.draft &&
    pr.checks === "SUCCESS" &&
    pr.mergeable === "MERGEABLE" &&
    (pr.reviewDecision === null || pr.reviewDecision === "REVIEW_REQUIRED")
  );
}

export function pullRequestSeverity(
  pr: OpenPullRequest,
  now: Date,
): { severity: Severity; reasons: string[] } {
  const reasons: string[] = [];
  const severities: Severity[] = ["info"];
  if (pr.draft) {
    return { severity: "info", reasons: ["draft"] };
  }
  if (pr.checks === "FAILURE" || pr.checks === "ERROR") {
    reasons.push("checks failing");
    severities.push("warning");
  }
  if (pr.mergeable === "CONFLICTING") {
    reasons.push("merge conflict");
    severities.push("warning");
  }
  if (daysSince(pr.updatedAt, now) >= OPS_POLICY.pullRequestStaleDays) {
    reasons.push(`stale ${String(Math.floor(daysSince(pr.updatedAt, now)))}d`);
    severities.push("warning");
  }
  if (pr.reviewDecision === "CHANGES_REQUESTED") {
    reasons.push("changes requested");
  }
  return { severity: worstSeverity(severities), reasons };
}

/** The `scope` of a conventional-commit title, when it names a service. */
export function serviceFromTitle(
  title: string,
  context: OpsContext,
): { service?: string } {
  const scope = /^[a-z]+\(([^)]+)\)!?:/u.exec(title)?.[1];
  const service =
    scope === undefined ? undefined : context.services.byId(scope);
  return service === undefined ? {} : { service: service.id };
}

function pullRequestSignal(
  pr: OpenPullRequest,
  context: OpsContext,
): SignalInput {
  const { severity, reasons } = pullRequestSeverity(pr, context.now);
  const author = authorClass(pr.author, pr.branch);
  return {
    id: `github:pr:${String(pr.number)}`,
    source: "github",
    section: "delivery",
    ...serviceFromTitle(pr.title, context),
    kind: "pull-request",
    severity,
    needsMe: awaitsReview(pr),
    title: truncate(`#${String(pr.number)} ${pr.title}`, 200),
    ...(reasons.length === 0 ? {} : { detail: reasons.join(", ") }),
    since: new Date(Date.parse(pr.createdAt)).toISOString(),
    attributes: {
      author: pr.author?.login ?? "(deleted)",
      authorClass: author,
      draft: pr.draft,
      checks: pr.checks,
      mergeable: pr.mergeable,
      review: pr.reviewDecision ?? "NONE",
      updatedAt: pr.updatedAt,
    },
    links: [{ kind: "github", label: `PR #${String(pr.number)}`, url: pr.url }],
  };
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1
    ? upper
    : ((sorted[middle - 1] ?? 0) + upper) / 2;
}

export type GitHubActivity = {
  open: readonly OpenPullRequest[];
  /** Merged over the last 30 days. */
  merged30d: readonly MergedPullRequest[];
  /** Commits touching the version catalog over the change window. */
  imagePins: readonly Commit[];
};

function mergeChanges(
  input: GitHubActivity,
  context: OpsContext,
): ChangeEventInput[] {
  const since = daysBefore(context.now, CHANGE_WINDOW_DAYS).getTime();
  const merges: ChangeEventInput[] = input.merged30d
    .filter((pr) => Date.parse(pr.mergedAt) >= since)
    .map((pr) => ({
      source: "github",
      externalId: `pr:${String(pr.number)}`,
      kind: "merge",
      ...serviceFromTitle(pr.title, context),
      title: truncate(`#${String(pr.number)} ${pr.title}`, 200),
      occurredAt: new Date(Date.parse(pr.mergedAt)).toISOString(),
      url: pr.url,
    }));
  const pins: ChangeEventInput[] = input.imagePins.map((commit) => ({
    source: "github",
    externalId: `commit:${commit.oid}`,
    kind: "image-bump",
    ...serviceFromTitle(commit.headline, context),
    title: truncate(commit.headline, 200),
    occurredAt: new Date(Date.parse(commit.committedAt)).toISOString(),
    url: commit.url,
  }));
  return [...merges, ...pins];
}

export function mapGitHub(
  input: GitHubActivity,
  context: OpsContext,
): OpsCollection {
  // Renovate PRs belong to the renovate source.
  const open = input.open.filter(
    (pr) => authorClass(pr.author, pr.branch) !== "renovate",
  );
  const signals = open.map((pr) => pullRequestSignal(pr, context));
  const weekAgo = daysBefore(context.now, 7).getTime();
  const merged7d = input.merged30d.filter(
    (pr) => Date.parse(pr.mergedAt) >= weekAgo,
  ).length;
  const hoursToMerge = input.merged30d.map(
    (pr) => (Date.parse(pr.mergedAt) - Date.parse(pr.createdAt)) / 3_600_000,
  );
  const awaitingMe = signals.filter((signal) => signal.needsMe).length;
  return {
    signals,
    metrics: [
      metric({
        section: "delivery",
        source: "github",
        id: METRIC_IDS.prsOpen,
        label: "Open PRs",
        value: open.length,
        unit: "count",
      }),
      metric({
        section: "delivery",
        source: "github",
        id: METRIC_IDS.prsAwaitingMe,
        label: "Awaiting your review",
        value: awaitingMe,
        unit: "count",
        severity: awaitingMe > 0 ? "info" : "ok",
      }),
      metric({
        section: "delivery",
        source: "github",
        id: METRIC_IDS.prsMerged7d,
        label: "Merged (7d)",
        value: merged7d,
        unit: "count",
      }),
      metric({
        section: "delivery",
        source: "github",
        id: METRIC_IDS.prMedianHoursToMerge30d,
        label: "Median hours to merge (30d)",
        value: median(hoursToMerge),
        unit: "hours",
      }),
    ],
    changes: mergeChanges(input, context),
  };
}
