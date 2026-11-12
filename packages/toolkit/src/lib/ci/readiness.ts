import type {
  CiPullRequest,
  CiRules,
  CommitCheck,
  CiReview,
} from "./github/schemas.ts";
import { isHumanReview } from "./github.ts";
import type { WoodpeckerPipeline } from "#lib/woodpecker/ci.ts";
import type { MainStatus } from "./main.ts";
import { isFailure, workflowStatus } from "./status.ts";

export type Outcome =
  | "ready"
  | "waiting"
  | "failure"
  | "human_action"
  | "head_changed"
  | "main_red"
  | "timeout"
  | "pr_closed"
  | "merged"
  | "merge_failed"
  | "error";
export const EXIT_CODES: Readonly<Record<Outcome, number>> = {
  ready: 0,
  merged: 0,
  waiting: 0,
  failure: 1,
  error: 2,
  human_action: 3,
  head_changed: 4,
  main_red: 5,
  timeout: 6,
  pr_closed: 7,
  merge_failed: 8,
};
/**
 * How a red main affects an otherwise ready PR. A red main never ends a wait
 * while the PR's own evidence is pending: `report` returns `main_red` once the
 * PR is ready, `require` keeps waiting for main to recover, and `ignore`
 * reports the PR ready.
 */
export type MainPolicy = "report" | "require" | "ignore";
export type Snapshot = {
  pr: CiPullRequest;
  pipeline: WoodpeckerPipeline | null;
  main: MainStatus;
  rules: CiRules;
  checks: CommitCheck[];
  reviews: CiReview[];
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  consistent?: boolean;
  pipelineUrl?: string | null;
  /**
   * Every GitHub input was read for this snapshot with no reuse (a forced
   * read). A terminal verdict from any other snapshot is judged again on a
   * forced read before it is reported.
   */
  githubFresh?: boolean;
};
export type Verdict = {
  outcome: Outcome;
  reasons: string[];
  commands: string[];
};

export function pipelineState(
  pipeline: WoodpeckerPipeline | null,
): "pass" | "fail" | "pending" | "human_action" {
  if (pipeline === null) return "pending";
  const overall = workflowStatus(pipeline.status);
  for (const workflow of pipeline.workflows) workflowStatus(workflow.state);
  if (pipeline.status === "blocked") return "human_action";
  if (
    overall === "UNHEALTHY" ||
    pipeline.workflows.some((workflow) => isFailure(workflow.state))
  )
    return "fail";
  const completion = pipeline.workflows.find(
    (workflow) => workflow.name === "ci-complete",
  );
  // A cheap draft run can be green at the same SHA later marked ready. It
  // never substitutes for the full ready-event pipeline, even if an old
  // completion status is still visible on GitHub.
  if (
    pipeline.pr_draft === true ||
    pipeline.workflows.some((workflow) => workflow.name === "draft-preflight")
  )
    return "pending";
  if (completion?.state === "success") return "pass";
  if (pipeline.event === "pull_request_metadata") return "pending";
  return overall === "HEALTHY" ? "pass" : "pending";
}

export function requiredChecks(snapshot: Snapshot): CommitCheck[] {
  return snapshot.rules.checks.map((required) => {
    const matches = snapshot.checks.filter(
      (check) =>
        check.name === required.name &&
        (required.appId === null || check.appId === required.appId),
    );
    // If multiple producers use one name, a passing sibling cannot hide a failing check.
    const check =
      matches.find(
        (item) => item.state === "fail" || item.state === "human_action",
      ) ??
      matches.find((item) => item.state === "pending") ??
      matches[0];
    const found: CommitCheck = check ?? {
      name: required.name,
      appId: required.appId,
      state: "pending",
      url: null,
    };
    if (!required.name.startsWith("ci/woodpecker/pr/")) return found;
    const workflow = snapshot.pipeline?.workflows.find(
      (item) => `ci/woodpecker/pr/${item.name}` === required.name,
    );
    if (workflow === undefined) return { ...found, state: "pending" };
    const status = workflowStatus(workflow.state);
    if (status === "UNHEALTHY") return { ...found, state: "fail" };
    const expected = snapshot.pipelineUrl;
    const published =
      found.state === "pass" &&
      found.url !== null &&
      expected !== undefined &&
      expected !== null &&
      found.url.startsWith(`${expected}/`);
    return {
      ...found,
      state: status === "HEALTHY" && published ? "pass" : "pending",
    };
  });
}

function humanChanges(snapshot: Snapshot): string[] {
  const latest = new Map<string, CiReview>();
  for (const review of snapshot.reviews.toSorted((a, b) =>
    (b.submitted_at ?? "").localeCompare(a.submitted_at ?? ""),
  )) {
    if (review.state === "COMMENTED" || review.state === "PENDING") continue;
    if (
      review.user !== null &&
      isHumanReview(review) &&
      !latest.has(review.user.login)
    )
      latest.set(review.user.login, review);
  }
  return [...latest]
    .filter(([, review]) => review.state === "CHANGES_REQUESTED")
    .map(
      ([author, review]) => `${author} requested changes: ${review.html_url}`,
    );
}

export function reviewBlockers(snapshot: Snapshot): string[] {
  const reasons = humanChanges(snapshot);
  if (snapshot.pr.draft) reasons.push("PR is a draft");
  if (snapshot.rules.approvals > 0 && snapshot.reviewDecision !== "APPROVED")
    reasons.push("Required review approval is outstanding");
  if (pipelineState(snapshot.pipeline) === "human_action")
    reasons.push("Woodpecker requires pipeline approval");
  for (const check of requiredChecks(snapshot))
    if (check.state === "human_action")
      reasons.push(`${check.name} requires intervention`);
  return reasons;
}

function structuralVerdict(
  snapshot: Snapshot,
  expectedHead: string,
): Verdict | null {
  const { pr, pipeline } = snapshot;
  if (pr.head.sha !== expectedHead)
    return {
      outcome: "head_changed",
      reasons: [`PR head changed from ${expectedHead} to ${pr.head.sha}`],
      commands: [`toolkit ci wait ${String(pr.number)} --head ${pr.head.sha}`],
    };
  if (pr.state === "closed" || pr.merged)
    return {
      outcome: "pr_closed",
      reasons: [pr.merged ? "PR is already merged" : "PR is closed"],
      commands: [],
    };
  if (
    snapshot.consistent === false ||
    (pipeline !== null && pipeline.commit !== pr.head.sha)
  )
    return {
      outcome: "waiting",
      reasons: ["PR changed during evidence collection; refreshing."],
      commands: [],
    };
  if (pr.mergeable === false)
    return {
      outcome: "failure",
      reasons: ["PR has merge conflicts"],
      commands: ["toolkit git-spice repo sync --restack=aboves"],
    };
  const human = reviewBlockers(snapshot);
  if (human.length > 0)
    return {
      outcome: "human_action",
      reasons: human,
      commands: [`toolkit pr review list ${String(pr.number)}`],
    };
  return snapshot.rules.strict && pr.mergeable_state === "behind"
    ? {
        outcome: "failure",
        reasons: ["Required checks must run on a branch current with its base"],
        commands: ["toolkit git-spice repo sync --restack=aboves"],
      }
    : null;
}

function failuresFor(
  snapshot: Snapshot,
  state: ReturnType<typeof pipelineState>,
): string[] {
  const failures = requiredChecks(snapshot)
    .filter((check) => check.state === "fail")
    .map((check) => `${check.name} failed`);
  if (state === "fail" && snapshot.pipeline !== null) {
    failures.unshift(
      ...snapshot.pipeline.workflows
        .filter((workflow) => isFailure(workflow.state))
        .map((workflow) => `${workflow.name} failed`),
      `Woodpecker pipeline #${String(snapshot.pipeline.number)} failed`,
    );
  }
  return [...new Set(failures)];
}

function pendingResults(
  snapshot: Snapshot,
  until: "first-failure" | "settled",
): boolean {
  const state = pipelineState(snapshot.pipeline);
  const pipeline = snapshot.pipeline;
  const unfinished =
    pipeline !== null &&
    pipeline.workflows.some(
      (workflow) => workflowStatus(workflow.state) === "PENDING",
    ) &&
    pipeline.workflows.find((workflow) => workflow.name === "ci-complete")
      ?.state !== "success";
  return (
    state === "pending" ||
    (until === "settled" && unfinished) ||
    requiredChecks(snapshot).some((check) => check.state === "pending")
  );
}

function redMainVerdict(policy: MainPolicy): Verdict {
  return policy === "require"
    ? {
        outcome: "waiting",
        reasons: [
          "The PR is ready, but main is red; waiting for main to recover before reporting ready.",
        ],
        commands: ["toolkit ci main"],
      }
    : {
        outcome: "main_red",
        reasons: [
          "The PR is ready, but main is red. Keep working; do not try to fix main unless explicitly told.",
        ],
        commands: ["toolkit ci main", "toolkit ci explain --main"],
      };
}

export function evaluateReadiness(
  snapshot: Snapshot,
  expectedHead: string,
  until: "first-failure" | "settled" = "first-failure",
  mainPolicy: MainPolicy = "report",
): Verdict {
  const structural = structuralVerdict(snapshot, expectedHead);
  if (structural !== null) return structural;
  const failures = failuresFor(snapshot, pipelineState(snapshot.pipeline));
  const pending = pendingResults(snapshot, until);
  if (failures.length > 0 && (until === "first-failure" || !pending))
    return {
      outcome: "failure",
      reasons: failures,
      commands: [`toolkit ci explain ${String(snapshot.pr.number)}`],
    };
  if (
    pending ||
    snapshot.pr.mergeable === null ||
    ["unknown", "blocked"].includes(snapshot.pr.mergeable_state)
  )
    return {
      outcome: "waiting",
      reasons: [
        "Waiting for blocking checks and merge metadata; long queues and builds are expected.",
      ],
      commands: ["toolkit ci load"],
    };
  return mainPolicy !== "ignore" && snapshot.main.state === "red"
    ? redMainVerdict(mainPolicy)
    : {
        outcome: "ready",
        reasons: [
          "Blocking checks passed; no human review or merge conflicts remain.",
        ],
        commands: [],
      };
}
