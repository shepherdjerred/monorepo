import { getBuildkiteBuildForCommit } from "#lib/buildkite/ci.ts";
import type { BuildkiteBuild } from "#lib/buildkite/ci.ts";
import { checkMergeConflicts } from "#lib/git/conflicts.ts";
import type { MergeCheckResult } from "#lib/git/conflicts.ts";
import { getGitHubChecks } from "#lib/github/checks.ts";
import {
  getLatestReviewsByAuthor,
  getPullRequest,
  getPullRequestForBranch,
} from "#lib/github/pr.ts";
import type {
  GitHubCheck,
  HealthCheck,
  HealthReport,
  HealthStatus,
  PullRequest,
} from "#lib/github/types.ts";
import { formatHealthReport, formatJson } from "#lib/output/formatter.ts";

const BUILDKITE_PIPELINE = "sjerred/monorepo";
const MONOREPO_REPOSITORY = "shepherdjerred/monorepo";

export type HealthOptions = {
  json?: boolean | undefined;
};

export type ReviewEvidence = {
  readonly author: string;
  readonly state: string;
};

export type PrHealthEvidence = {
  readonly pr: PullRequest;
  readonly merge: MergeCheckResult;
  readonly githubChecks: readonly GitHubCheck[];
  readonly buildkiteBuild: BuildkiteBuild | null;
  readonly reviews: readonly ReviewEvidence[];
};

function statusForBuildkiteBuild(state: string): HealthStatus {
  switch (state.toLowerCase()) {
    case "passed":
      return "HEALTHY";
    case "failed":
    case "failing":
    case "canceled":
    case "cancelled":
    case "timed_out":
    case "skipped":
    case "not_run":
      return "UNHEALTHY";
    case "scheduled":
    case "running":
    case "creating":
    case "waiting":
    case "blocked":
    case "canceling":
    case "cancelling":
      return "PENDING";
    default:
      throw new Error(`Unknown Buildkite build state: ${state}`);
  }
}

function statusForGitHubCheck(check: GitHubCheck): HealthStatus {
  switch (check.bucket.toLowerCase()) {
    case "pass":
    case "skipping":
      return "HEALTHY";
    case "fail":
    case "cancel":
      return "UNHEALTHY";
    case "pending":
      return "PENDING";
    default:
      throw new Error(
        `Unknown GitHub check bucket for ${check.name}: ${check.bucket}`,
      );
  }
}

function isBuildkiteCheck(check: GitHubCheck): boolean {
  if (check.name.startsWith("buildkite/")) {
    return true;
  }
  if (check.link === undefined || check.link.length === 0) {
    return false;
  }
  try {
    return new URL(check.link).hostname === "buildkite.com";
  } catch {
    return false;
  }
}

function mergeHealth(result: MergeCheckResult): HealthCheck {
  if (result.hasConflicts) {
    return {
      name: "Merge Conflicts",
      status: "UNHEALTHY",
      details: [
        `PR head ${result.headSha.slice(0, 12)} conflicts with current origin/${result.baseBranch}`,
        ...result.conflictingFiles.map((file) => `Conflicting file: ${file}`),
      ],
      commands: ["toolkit git-spice repo sync --restack=aboves"],
    };
  }
  if (!result.upToDate) {
    return {
      name: "Merge Conflicts",
      status: "PENDING",
      details: [
        `No merge conflicts with current origin/${result.baseBranch}`,
        `PR head ${result.headSha.slice(0, 12)} is behind origin/${result.baseBranch}`,
      ],
      commands: ["toolkit git-spice repo sync --restack=aboves"],
    };
  }
  return {
    name: "Merge Conflicts",
    status: "HEALTHY",
    details: [
      `PR head ${result.headSha.slice(0, 12)} merges cleanly with current origin/${result.baseBranch}`,
      `Up to date with origin/${result.baseBranch}`,
    ],
  };
}

function hardFailureJob(state: string): boolean {
  return ["failed", "timed_out", "canceled", "cancelled", "expired"].includes(
    state.toLowerCase(),
  );
}

function loggableFailureJob(state: string): boolean {
  return ["failed", "timed_out"].includes(state.toLowerCase());
}

function aggregateStatuses(statuses: readonly HealthStatus[]): HealthStatus {
  if (statuses.includes("UNHEALTHY")) {
    return "UNHEALTHY";
  }
  if (statuses.includes("PENDING")) {
    return "PENDING";
  }
  return "HEALTHY";
}

export function ciHealth(
  headSha: string,
  githubChecks: readonly GitHubCheck[],
  build: BuildkiteBuild | null,
): HealthCheck {
  const details: string[] = [];
  const commands: string[] = [];
  let buildkiteStatus: HealthStatus = "PENDING";

  if (build === null) {
    details.push(
      `No Buildkite build found for exact PR head ${headSha.slice(0, 12)}`,
    );
    commands.push(
      `toolkit bk build list --pipeline ${BUILDKITE_PIPELINE} --commit ${headSha}`,
    );
  } else {
    buildkiteStatus = statusForBuildkiteBuild(build.state);
    details.push(
      `Buildkite build #${String(build.number)} for exact head ${headSha.slice(0, 12)}: ${build.state.toUpperCase()}`,
    );
    commands.push(
      `toolkit bk build view ${String(build.number)} --pipeline ${BUILDKITE_PIPELINE}`,
    );

    const hardFailures = build.jobs.filter(
      (job) => hardFailureJob(job.state) && job.soft_failed !== true,
    );
    if (hardFailures.length > 0) {
      buildkiteStatus = "UNHEALTHY";
    }
    for (const job of hardFailures) {
      details.push(`Job "${job.name}" - ${job.state.toUpperCase()}`);
      if (loggableFailureJob(job.state)) {
        commands.push(`toolkit bk job log ${job.id} --agent`);
      }
    }
    const softFailures = build.jobs.filter(
      (job) => hardFailureJob(job.state) && job.soft_failed === true,
    );
    for (const job of softFailures) {
      details.push(
        `Soft-failed job "${job.name}" - ${job.state.toUpperCase()}`,
      );
    }
  }

  const buildkiteChecks = githubChecks.filter((check) =>
    isBuildkiteCheck(check),
  );
  const externalChecks = githubChecks.filter(
    (check) => !isBuildkiteCheck(check) && check.name !== "ci/merge-conflict",
  );
  const externalStatuses = new Set(
    externalChecks.map((check) => statusForGitHubCheck(check)),
  );
  for (const check of externalChecks) {
    const status = statusForGitHubCheck(check);
    if (status !== "HEALTHY") {
      details.push(`GitHub check "${check.name}" - ${check.state}`);
    }
  }

  if (build !== null && buildkiteChecks.length > 0) {
    const githubBuildkiteStatus = aggregateStatuses(
      buildkiteChecks.map((check) => statusForGitHubCheck(check)),
    );
    if (githubBuildkiteStatus !== buildkiteStatus) {
      details.push(
        `GitHub's Buildkite check metadata does not match authoritative build #${String(build.number)}; using Buildkite`,
      );
    }
  }

  let status = buildkiteStatus;
  if (externalStatuses.has("UNHEALTHY")) {
    status = "UNHEALTHY";
  } else if (status !== "UNHEALTHY" && externalStatuses.has("PENDING")) {
    status = "PENDING";
  }

  return { name: "CI Status", status, details, commands };
}

function approvalHealth(
  reviewDecision: PullRequest["reviewDecision"],
  reviews: readonly ReviewEvidence[],
): HealthCheck {
  const details = reviews.map((review) => `${review.author}: ${review.state}`);
  if (reviewDecision === "APPROVED") {
    return { name: "Approval", status: "HEALTHY", details };
  }
  if (reviewDecision === "CHANGES_REQUESTED") {
    return { name: "Approval", status: "UNHEALTHY", details };
  }
  return {
    name: "Approval",
    status: "PENDING",
    details: details.length === 0 ? ["No reviews yet"] : details,
  };
}

export function buildPrHealthReport(evidence: PrHealthEvidence): HealthReport {
  const checks = [
    mergeHealth(evidence.merge),
    ciHealth(
      evidence.pr.headRefOid,
      evidence.githubChecks,
      evidence.buildkiteBuild,
    ),
    approvalHealth(evidence.pr.reviewDecision, evidence.reviews),
  ];
  let overallStatus: HealthStatus = "HEALTHY";
  if (checks.some((check) => check.status === "UNHEALTHY")) {
    overallStatus = "UNHEALTHY";
  } else if (checks.some((check) => check.status === "PENDING")) {
    overallStatus = "PENDING";
  }

  const nextSteps: string[] = [];
  const [merge, ci, approval] = checks;
  if (merge?.status === "UNHEALTHY") {
    nextSteps.push("Resolve merge conflicts and restack the branch");
  } else if (merge?.status === "PENDING") {
    nextSteps.push("Restack the branch on current origin/main");
  }
  if (ci?.status === "UNHEALTHY") {
    nextSteps.push(
      "Inspect the exact-head Buildkite build and fix hard failures",
    );
  } else if (ci?.status === "PENDING") {
    nextSteps.push("Wait for the exact-head Buildkite build to complete");
  }
  if (approval?.status === "UNHEALTHY") {
    nextSteps.push("Address review feedback");
  } else if (approval?.status === "PENDING") {
    nextSteps.push("Request review");
  }

  return {
    prNumber: evidence.pr.number,
    prUrl: evidence.pr.url,
    overallStatus,
    checks,
    nextSteps,
  };
}

export async function healthCommand(
  prNumber?: string,
  options: HealthOptions = {},
): Promise<void> {
  const pr =
    prNumber !== undefined && prNumber.length > 0
      ? await getPullRequest(prNumber, MONOREPO_REPOSITORY)
      : await getPullRequestForBranch(MONOREPO_REPOSITORY);
  if (pr === null) {
    console.error(
      prNumber !== undefined && prNumber.length > 0
        ? `Error: PR #${prNumber} not found`
        : "Error: No PR found for current branch",
    );
    process.exit(1);
  }

  const [merge, githubChecks, buildkiteBuild, reviewMap] = await Promise.all([
    checkMergeConflicts(pr.number, pr.baseRefName, pr.headRefOid),
    getGitHubChecks(pr.number, MONOREPO_REPOSITORY),
    getBuildkiteBuildForCommit(pr.headRefOid),
    getLatestReviewsByAuthor(pr.number, MONOREPO_REPOSITORY),
  ]);
  const report = buildPrHealthReport({
    pr,
    merge,
    githubChecks,
    buildkiteBuild,
    reviews: [...reviewMap].map(([author, review]) => ({
      author,
      state: review.state,
    })),
  });

  console.log(
    options.json === true ? formatJson(report) : formatHealthReport(report),
  );
  if (report.overallStatus === "UNHEALTHY") {
    process.exit(1);
  }
}
