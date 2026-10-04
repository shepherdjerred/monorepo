import type {
  CiPullRequest,
  CiRules,
  CommitCheck,
  CiReview,
} from "./github.ts";
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
  | "error";
export const EXIT_CODES: Readonly<Record<Outcome, number>> = {
  ready: 0,
  waiting: 0,
  failure: 1,
  error: 2,
  human_action: 3,
  head_changed: 4,
  main_red: 5,
  timeout: 6,
  pr_closed: 7,
};
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
  if (completion?.state === "success") return "pass";
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

function humanBlockers(snapshot: Snapshot): string[] {
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
  const { pr, pipeline, main } = snapshot;
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
  if (main.state === "red")
    return {
      outcome: "main_red",
      reasons: [
        "Main is red; report the failure and await instructions. Do not repair main.",
      ],
      commands: ["toolkit ci main", "toolkit ci explain --main"],
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
  const human = humanBlockers(snapshot);
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

export function evaluateReadiness(
  snapshot: Snapshot,
  expectedHead: string,
  until: "first-failure" | "settled" = "first-failure",
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
  return pending ||
    snapshot.pr.mergeable === null ||
    ["unknown", "blocked"].includes(snapshot.pr.mergeable_state)
    ? {
        outcome: "waiting",
        reasons: [
          "Waiting for blocking checks and merge metadata; long queues and builds are expected.",
        ],
        commands: ["toolkit ci load"],
      }
    : {
        outcome: "ready",
        reasons: [
          "Blocking checks passed; no human review or merge conflicts remain.",
        ],
        commands: [],
      };
}
