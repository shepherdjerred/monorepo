import {
  getPullRequest,
  getPullRequestForBranch,
  getLatestReviewsByAuthor,
  getCheckRuns,
  getFailedJobs,
  type HealthReport,
  type HealthCheck,
  type HealthStatus,
} from "../../lib/github/index.ts";
import { checkMergeConflicts, isBranchUpToDate } from "../../lib/git/index.ts";
import { formatHealthReport, formatJson } from "../../lib/output/index.ts";

export type HealthOptions = {
  repo?: string | undefined;
  json?: boolean | undefined;
}

export async function healthCommand(
  prNumber?: string,
  options: HealthOptions = {}
): Promise<void> {
  // Get PR - either by number or from current branch
  const pr = prNumber
    ? await getPullRequest(prNumber, options.repo)
    : await getPullRequestForBranch(options.repo);

  if (!pr) {
    console.error(
      prNumber
        ? `Error: PR #${prNumber} not found`
        : "Error: No PR found for current branch"
    );
    process.exit(1);
  }

  const checks: HealthCheck[] = [];
  const nextSteps: string[] = [];

  // Check 1: Merge conflicts
  const conflictCheck = await checkMergeConflictsHealth(pr.baseRefName);
  checks.push(conflictCheck);
  if (conflictCheck.status === "UNHEALTHY") {
    nextSteps.push("Resolve merge conflicts");
  }

  // Check 2: CI Status
  const ciCheck = await checkCIHealth(pr.number, options.repo);
  checks.push(ciCheck);
  if (ciCheck.status === "UNHEALTHY") {
    nextSteps.push("Fix CI failures");
  } else if (ciCheck.status === "PENDING") {
    nextSteps.push("Wait for CI to complete");
  }

  // Check 3: Approval status
  const approvalCheck = await checkApprovalHealth(pr.number, pr.reviewDecision, options.repo);
  checks.push(approvalCheck);
  if (approvalCheck.status === "UNHEALTHY") {
    nextSteps.push("Address review feedback");
  } else if (approvalCheck.status === "PENDING") {
    nextSteps.push("Request review");
  }

  // Determine overall status
  let overallStatus: HealthStatus = "HEALTHY";
  if (checks.some((c) => c.status === "UNHEALTHY")) {
    overallStatus = "UNHEALTHY";
  } else if (checks.some((c) => c.status === "PENDING")) {
    overallStatus = "PENDING";
  }

  const report: HealthReport = {
    prNumber: pr.number,
    prUrl: pr.url,
    overallStatus,
    checks,
    nextSteps,
  };

  if (options.json) {
    console.log(formatJson(report));
  } else {
    console.log(formatHealthReport(report));
  }

  // Exit with non-zero if unhealthy
  if (overallStatus === "UNHEALTHY") {
    process.exit(1);
  }
}

async function checkMergeConflictsHealth(
  baseBranch: string
): Promise<HealthCheck> {
  const result = await checkMergeConflicts(baseBranch);
  const upToDate = await isBranchUpToDate(baseBranch);

  const details: string[] = [];
  const commands: string[] = [];

  if (result.hasConflicts) {
    details.push("Branch has merge conflicts with base");
    if (result.conflictingFiles.length > 0) {
      for (const file of result.conflictingFiles) {
        details.push(`Conflicting file: ${file}`);
      }
    }
    commands.push(`git fetch origin ${baseBranch} && git merge origin/${baseBranch}`);

    return {
      name: "Merge Conflicts",
      status: "UNHEALTHY",
      details,
      commands,
    };
  }

  if (!upToDate) {
    details.push(`Branch is behind origin/${baseBranch}`);
    commands.push(`git fetch origin ${baseBranch} && git merge origin/${baseBranch}`);

    return {
      name: "Merge Conflicts",
      status: "PENDING",
      details,
      commands,
    };
  }

  details.push("No merge conflicts");
  details.push(`Up to date with origin/${baseBranch}`);

  return {
    name: "Merge Conflicts",
    status: "HEALTHY",
    details,
  };
}

async function checkCIHealth(
  prNumber: number,
  repo?: string
): Promise<HealthCheck> {
  const checkRuns = await getCheckRuns(prNumber, repo);

  if (checkRuns.length === 0) {
    return {
      name: "CI Status",
      status: "PENDING",
      details: ["No CI checks found"],
    };
  }

  const failed = checkRuns.filter((c) => c.conclusion === "failure");
  const pending = checkRuns.filter(
    (c) => c.status === "in_progress" || c.status === "queued"
  );
  const passed = checkRuns.filter((c) => c.conclusion === "success");

  const details: string[] = [];
  const commands: string[] = [];

  if (failed.length > 0) {
    const failedJobs = await getFailedJobs(prNumber, repo);

    for (const check of failed) {
      details.push(`Job "${check.name}" - FAILED`);
    }

    if (failedJobs.length > 0) {
      const firstFailed = failedJobs[0];
      if (firstFailed) {
        details.push(`Run ID: ${String(firstFailed.runId)}`);
        commands.push(`tools pr logs ${String(firstFailed.runId)} --failed-only`);
      }
    }

    return {
      name: "CI Status",
      status: "UNHEALTHY",
      details,
      commands,
    };
  }

  if (pending.length > 0) {
    for (const check of pending) {
      details.push(`Job "${check.name}" - ${check.status.toUpperCase()}`);
    }

    return {
      name: "CI Status",
      status: "PENDING",
      details,
    };
  }

  details.push(`${String(passed.length)} check${passed.length !== 1 ? "s" : ""} passed`);

  return {
    name: "CI Status",
    status: "HEALTHY",
    details,
  };
}

async function checkApprovalHealth(
  prNumber: number,
  reviewDecision: string | null,
  repo?: string
): Promise<HealthCheck> {
  const reviews = await getLatestReviewsByAuthor(prNumber, repo);

  const details: string[] = [];

  if (reviews.size === 0) {
    return {
      name: "Approval",
      status: "PENDING",
      details: ["No reviews yet"],
    };
  }

  // List all reviewers and their states
  for (const [author, review] of reviews) {
    details.push(`${author}: ${review.state}`);
  }

  // Check overall review decision
  if (reviewDecision === "APPROVED") {
    return {
      name: "Approval",
      status: "HEALTHY",
      details,
    };
  }

  if (reviewDecision === "CHANGES_REQUESTED") {
    return {
      name: "Approval",
      status: "UNHEALTHY",
      details,
    };
  }

  // REVIEW_REQUIRED or null
  return {
    name: "Approval",
    status: "PENDING",
    details,
  };
}
