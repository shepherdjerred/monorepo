import type {
  Classification,
  PrIdentity,
  PrState,
  ReadinessEvidence,
} from "./schemas.ts";

export type RefreshedPr = {
  identity: PrIdentity;
  evidence: ReadinessEvidence;
  stackId: string;
};

export function currentTimestamp(): string {
  return new Date().toISOString();
}

export function classify(
  identity: PrIdentity,
  evidence: ReadinessEvidence,
  paused: boolean,
): Classification {
  if (paused) {
    return "paused";
  }
  if (evidence.conflict) {
    return "conflict";
  }
  const blockingReview = evidence.reviewFindings.some(
    (finding) =>
      !finding.resolved &&
      !finding.outdated &&
      ["P0", "P1", "P2", "P3", "unknown"].includes(finding.severity),
  );
  const hardFailure = evidence.checks.some(
    (check) =>
      !check.softFail &&
      (check.bucket.toLowerCase() === "fail" ||
        check.state.toLowerCase() === "failure"),
  );
  if (blockingReview || hardFailure) {
    return identity.crossRepository && !identity.maintainerCanModify
      ? "paused"
      : "actionable-red";
  }
  const pendingCheck =
    evidence.checks.length === 0 ||
    evidence.checks.some((check) =>
      ["pending", "queued", "in_progress"].includes(check.bucket.toLowerCase()),
    );
  return pendingCheck ||
    !evidence.buildkiteCurrentHead ||
    !evidence.hostedReviewComplete
    ? "pending"
    : "green";
}

export function statusFor(classification: Classification): PrState["status"] {
  const statuses: Partial<Record<Classification, PrState["status"]>> = {
    green: "green",
    pending: "waiting-ci",
    paused: "paused",
    queued: "queued",
  };
  return statuses[classification] ?? "diagnosing";
}

export async function mapBounded<T, U>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      const value = values[index];
      if (value !== undefined) {
        results[index] = await operation(value);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  );
  return results;
}

export function computeStackIds(prs: PrIdentity[]): Map<number, string> {
  const byHead = new Map(prs.map((pr) => [pr.headRefName, pr]));
  const result = new Map<number, string>();
  for (const pr of prs) {
    let root = pr;
    const seen = new Set<number>();
    while (!seen.has(root.number)) {
      seen.add(root.number);
      const parent = byHead.get(root.baseRefName);
      if (parent === undefined) {
        break;
      }
      root = parent;
    }
    result.set(pr.number, `pr-${String(root.number)}`);
  }
  return result;
}

export function buildPrState(
  item: RefreshedPr,
  previous: PrState | undefined,
  pausedReason: string | undefined,
  model: string,
): { state: PrState; change: string | null } {
  const classification = classify(
    item.identity,
    item.evidence,
    pausedReason !== undefined,
  );
  const changedHead =
    previous !== undefined &&
    previous.identity.headSha !== item.identity.headSha;
  const changedClassification =
    previous !== undefined && previous.classification !== classification;
  const timestamp = currentTimestamp();
  const prNumber = String(item.identity.number);
  const retained = retainedPrState(
    previous,
    changedHead || changedClassification,
    timestamp,
  );
  const state: PrState = {
    identity: item.identity,
    logicalOwner: `pr-${prNumber}`,
    ...retained,
    model,
    status: statusFor(classification),
    classification,
    stackId: item.stackId,
    evidence: item.evidence,
    escalation: pausedReason ?? retained.escalation,
  };
  return { state, change: describeStateChange(previous, item, classification) };
}

function retainedPrState(
  previous: PrState | undefined,
  madeProgress: boolean,
  timestamp: string,
): Pick<
  PrState,
  | "runtimeAgent"
  | "agentGeneration"
  | "worktree"
  | "setupComplete"
  | "lastAgentReportAt"
  | "lastProgressAt"
  | "noProgressTicks"
  | "prodSentAt"
  | "escalation"
  | "priority"
> {
  if (previous === undefined) {
    return {
      runtimeAgent: null,
      agentGeneration: 0,
      worktree: null,
      setupComplete: false,
      lastAgentReportAt: null,
      lastProgressAt: timestamp,
      noProgressTicks: 0,
      prodSentAt: null,
      escalation: null,
      priority: 0,
    };
  }
  return {
    runtimeAgent: previous.runtimeAgent,
    agentGeneration: previous.agentGeneration,
    worktree: previous.worktree,
    setupComplete: previous.setupComplete,
    lastAgentReportAt: previous.lastAgentReportAt,
    lastProgressAt: madeProgress ? timestamp : previous.lastProgressAt,
    noProgressTicks: madeProgress ? 0 : previous.noProgressTicks + 1,
    prodSentAt: previous.prodSentAt,
    escalation: previous.escalation,
    priority: previous.priority,
  };
}

function describeStateChange(
  previous: PrState | undefined,
  item: RefreshedPr,
  classification: Classification,
): string | null {
  const prNumber = String(item.identity.number);
  if (previous === undefined) {
    return `discovered PR #${prNumber}`;
  }
  if (previous.identity.headSha !== item.identity.headSha) {
    return `PR #${prNumber} head changed to ${item.identity.headSha}`;
  }
  return previous.classification === classification
    ? null
    : `PR #${prNumber} ${previous.classification} -> ${classification}`;
}
