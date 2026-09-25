import { getWoodpeckerPipelineForCommit } from "#lib/woodpecker/ci.ts";
import type { WoodpeckerPipeline } from "#lib/woodpecker/ci.ts";
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
  readonly ciPipeline: WoodpeckerPipeline | null;
  readonly reviews: readonly ReviewEvidence[];
};

/**
 * Map a Woodpecker pipeline status onto PR health.
 *
 * Throws on an unrecognised status rather than guessing. A status this does
 * not know about is a Woodpecker upgrade that changed the vocabulary, and
 * defaulting it either way would silently misreport whether a PR is safe to
 * merge.
 *
 * `skipped` and `blocked` are UNHEALTHY rather than pending: a pipeline that
 * was skipped never ran the gates, and one blocked on approval will not
 * proceed without a human.
 */
function statusForWoodpeckerPipeline(state: string): HealthStatus {
  switch (state.toLowerCase()) {
    case "success":
      return "HEALTHY";
    case "failure":
    case "error":
    case "killed":
    case "declined":
    case "skipped":
    case "blocked":
      return "UNHEALTHY";
    case "pending":
    case "running":
    case "started":
    case "waiting":
    case "waiting_on_deps":
      return "PENDING";
    default:
      throw new Error(`Unknown Woodpecker pipeline status: ${state}`);
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

/**
 * Is this GitHub check the one our own CI posts?
 *
 * Matched by host rather than only by name so a renamed status context does
 * not start being double-counted as an unrelated external check.
 */
function isOwnCiCheck(check: GitHubCheck): boolean {
  if (check.name.startsWith("ci/woodpecker")) {
    return true;
  }
  if (check.link === undefined || check.link.length === 0) {
    return false;
  }
  try {
    return new URL(check.link).hostname === "woodpecker.sjer.red";
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

/**
 * Did this workflow fail in a way that blocks the PR?
 *
 * There is no soft-failure state to exclude any more. The advisory scanners
 * decide inside their own command whether findings are fatal and exit 0 when
 * they are not, so anything that reaches here as failed genuinely failed.
 */
function failedWorkflow(state: string): boolean {
  return ["failure", "error", "killed", "declined"].includes(
    state.toLowerCase(),
  );
}

function aggregateStatuses(statuses: readonly HealthStatus[]): HealthStatus {
  if (statuses.includes("UNHEALTHY")) {
    return "UNHEALTHY";
  }
  return statuses.includes("PENDING") ? "PENDING" : "HEALTHY";
}

export function ciHealth(
  headSha: string,
  githubChecks: readonly GitHubCheck[],
  pipeline: WoodpeckerPipeline | null,
): HealthCheck {
  const details: string[] = [];
  const commands: string[] = [];
  let ciStatus: HealthStatus = "PENDING";

  if (pipeline === null) {
    details.push(
      `No Woodpecker pipeline found for exact PR head ${headSha.slice(0, 12)}`,
    );
    commands.push(`toolkit woodpecker pipeline ls ${MONOREPO_REPOSITORY}`);
  } else {
    ciStatus = statusForWoodpeckerPipeline(pipeline.status);
    details.push(
      `Woodpecker pipeline #${String(pipeline.number)} for exact head ${headSha.slice(0, 12)}: ${pipeline.status.toUpperCase()}`,
    );
    commands.push(
      `toolkit woodpecker pipeline show ${MONOREPO_REPOSITORY} ${String(pipeline.number)}`,
    );

    const failures = pipeline.workflows.filter((workflow) =>
      failedWorkflow(workflow.state),
    );
    if (failures.length > 0) {
      ciStatus = "UNHEALTHY";
    }
    for (const workflow of failures) {
      details.push(
        `Workflow "${workflow.name}" - ${workflow.state.toUpperCase()}`,
      );
    }
    if (failures.length > 0) {
      // One command for the whole pipeline rather than one per workflow: the
      // CLI's log command is addressed by step id, and a workflow name is not
      // one. The failing workflows are named in the details above.
      commands.push(
        `toolkit woodpecker pipeline log show ${MONOREPO_REPOSITORY} ${String(pipeline.number)}`,
      );
    }
  }

  const ownCiChecks = githubChecks.filter((check) => isOwnCiCheck(check));
  const externalChecks = githubChecks.filter(
    (check) => !isOwnCiCheck(check) && check.name !== "ci/merge-conflict",
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

  if (pipeline !== null && ownCiChecks.length > 0) {
    const githubReportedStatus = aggregateStatuses(
      ownCiChecks.map((check) => statusForGitHubCheck(check)),
    );
    if (githubReportedStatus !== ciStatus) {
      details.push(
        `GitHub's check metadata disagrees with authoritative pipeline #${String(pipeline.number)}; trusting Woodpecker`,
      );
    }
  }

  let status = ciStatus;
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
      evidence.ciPipeline,
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
      "Inspect the exact-head Woodpecker pipeline and fix hard failures",
    );
  } else if (ci?.status === "PENDING") {
    nextSteps.push("Wait for the exact-head Woodpecker pipeline to complete");
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

  const [merge, githubChecks, ciPipeline, reviewMap] = await Promise.all([
    checkMergeConflicts(pr.number, pr.baseRefName, pr.headRefOid),
    getGitHubChecks(pr.number, MONOREPO_REPOSITORY),
    getWoodpeckerPipelineForCommit(pr.headRefOid),
    getLatestReviewsByAuthor(pr.number, MONOREPO_REPOSITORY),
  ]);
  const report = buildPrHealthReport({
    pr,
    merge,
    githubChecks,
    ciPipeline,
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
