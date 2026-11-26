import { z } from "zod";

export const ImpactReceiptSchema = z.object({
  timestamp: z.string(),
  pr: z.number().int().positive(),
  headSha: z.string(),
  mergeBaseSha: z.string(),
  mainHeadSha: z.string(),
  behindBy: z.number().int().nonnegative(),
  verdict: z.enum(["up_to_date", "disjoint_clean", "stale_overlap"]),
  bypassed: z.boolean(),
  reasons: z.array(z.string()),
});
export type ImpactReceipt = z.infer<typeof ImpactReceiptSchema>;

export const WoodpeckerWorkflowSummarySchema = z.object({
  name: z.string(),
  state: z.string(),
});

export const WoodpeckerPipelineItemSchema = z.object({
  number: z.number().int().positive(),
  commit: z.string(),
  mergeBaseSha: z.string().optional(),
  status: z.string(),
  event: z.string(),
  event_reason: z.array(z.string()).nullish(),
  pr_draft: z.boolean().optional(),
  ref: z.string().optional(),
  branch: z.string().optional(),
  created: z.number().optional(),
  workflows: z.array(WoodpeckerWorkflowSummarySchema).default([]),
});
export type WoodpeckerPipelineItem = z.infer<
  typeof WoodpeckerPipelineItemSchema
>;

export const NOV_10_23_BASELINE = {
  windowLabel: "2026-11-10..2026-11-23 (14d, 601 merges)",
  staleSkewIncidentsPerDay: 0.71,
  verifyOnsetsPerDay: 1.64,
  postGreenRestackRate: 0,
  twoPlusRestackRate: 0,
} as const;

export const THRESHOLDS = {
  keepMaxPostGreenRestackRate: 0.25,
  rollbackMinPostGreenRestackRate: 0.35,
  keepMaxTwoPlusRestackRate: 0.03,
  rollbackMinTwoPlusRestackRate: 0.05,
  keepMaxVerifyOnsetsPerDay: 0.5,
} as const;

export type GateVerdict = "KEEP" | "MONITOR" | "ROLLBACK";

export type ImpactScorecard = {
  readonly window: {
    readonly since: string;
    readonly until: string;
    readonly days: number;
  };
  readonly main: {
    readonly pushPipelines: number;
    readonly completedVerifyPipelines: number;
    readonly verifyFailedPipelines: number;
    readonly verifyFailureOnsets: number;
    readonly verifyOnsetsPerDay: number;
  };
  readonly pullRequests: {
    readonly evaluatedPrs: number;
    readonly prsWithGreenHead: number;
    readonly postGreenRestackedPrs: number;
    readonly postGreenRestackRate: number;
    readonly twoPlusRestackedPrs: number;
    readonly twoPlusRestackRate: number;
    readonly skewsCaughtOnRestack: number;
  };
  readonly receipts: {
    readonly available: boolean;
    readonly path: string;
    readonly totalEvaluations: number;
    readonly upToDate: number;
    readonly disjointClean: number;
    readonly staleBlocked: number;
    readonly staleBypassed: number;
    readonly staleBlockRate: number;
    readonly prsWithTwoPlusStaleBlocks: number;
  };
  readonly baseline: typeof NOV_10_23_BASELINE;
  readonly decision: {
    readonly verdict: GateVerdict;
    readonly reasons: readonly string[];
    readonly rollbackActions: readonly string[];
  };
};

function isReadyPrPipeline(pipeline: WoodpeckerPipelineItem): boolean {
  return (
    pipeline.pr_draft !== true &&
    (pipeline.event === "pull_request" ||
      (pipeline.event === "pull_request_metadata" &&
        pipeline.event_reason?.includes("ready_for_review") === true))
  );
}

function parsePrNumberFromRef(ref: string | undefined): number | null {
  const match = ref === undefined ? null : /^refs\/pull\/(\d+)\//u.exec(ref);
  return match?.[1] === undefined ? null : Number.parseInt(match[1], 10);
}

function isVerifyFailure(pipeline: WoodpeckerPipelineItem): boolean {
  return pipeline.workflows.length === 0
    ? pipeline.status === "failure" || pipeline.status === "error"
    : pipeline.workflows.some(
        (wf) =>
          (wf.name === "verify" || wf.name === "playwright-e2e") &&
          ["failure", "error", "killed", "declined"].includes(
            wf.state.toLowerCase(),
          ),
      );
}

function isVerifySuccess(pipeline: WoodpeckerPipelineItem): boolean {
  if (isVerifyFailure(pipeline)) {
    return false;
  }
  if (pipeline.workflows.length === 0) {
    return pipeline.status.toLowerCase() === "success";
  }
  const verifyWorkflows = pipeline.workflows.filter(
    (wf) => wf.name === "verify" || wf.name === "playwright-e2e",
  );
  return verifyWorkflows.length === 0
    ? pipeline.status.toLowerCase() === "success"
    : verifyWorkflows.every((wf) => wf.state.toLowerCase() === "success");
}

function isVerifyCompleted(pipeline: WoodpeckerPipelineItem): boolean {
  return ["success", "failure", "error"].includes(
    pipeline.status.toLowerCase(),
  );
}

export function summarizeMainPipelines(
  pipelines: readonly WoodpeckerPipelineItem[],
  days: number,
): ImpactScorecard["main"] {
  const ordered = [...pipelines].sort((a, b) => a.number - b.number);
  let completedVerifyPipelines = 0;
  let verifyFailedPipelines = 0;
  let verifyFailureOnsets = 0;
  let inFailureStreak = false;

  for (const pipeline of ordered) {
    if (!isVerifyCompleted(pipeline)) {
      continue;
    }
    completedVerifyPipelines += 1;
    if (isVerifyFailure(pipeline)) {
      verifyFailedPipelines += 1;
      if (!inFailureStreak) {
        verifyFailureOnsets += 1;
        inFailureStreak = true;
      }
    } else if (isVerifySuccess(pipeline)) {
      inFailureStreak = false;
    }
  }

  return {
    pushPipelines: pipelines.length,
    completedVerifyPipelines,
    verifyFailedPipelines,
    verifyFailureOnsets,
    verifyOnsetsPerDay:
      days > 0 ? verifyFailureOnsets / days : verifyFailureOnsets,
  };
}

function groupReadyPipelinesByPr(
  pipelines: readonly WoodpeckerPipelineItem[],
): Map<number, WoodpeckerPipelineItem[]> {
  const byPr = new Map<number, WoodpeckerPipelineItem[]>();
  for (const pipeline of pipelines) {
    if (!isReadyPrPipeline(pipeline)) {
      continue;
    }
    const pr = parsePrNumberFromRef(pipeline.ref);
    if (pr === null) {
      continue;
    }
    const list = byPr.get(pr) ?? [];
    list.push(pipeline);
    byPr.set(pr, list);
  }
  return byPr;
}

export function collectPostGreenCandidateCommits(
  pipelines: readonly WoodpeckerPipelineItem[],
): string[] {
  const candidateCommits = new Set<string>();
  for (const runs of groupReadyPipelinesByPr(pipelines).values()) {
    const ordered = [...runs].sort((a, b) => a.number - b.number);
    const firstGreenIdx = ordered.findIndex(
      (run) => run.status.toLowerCase() === "success",
    );
    const firstGreen = ordered[firstGreenIdx];
    if (firstGreenIdx === -1 || firstGreen === undefined) continue;
    const afterGreen = ordered
      .slice(firstGreenIdx + 1)
      .filter((run) => run.commit !== firstGreen.commit);
    if (afterGreen.length === 0) continue;
    candidateCommits.add(firstGreen.commit);
    for (const run of afterGreen) candidateCommits.add(run.commit);
  }
  return [...candidateCommits];
}

export type SummarizePrOptions = {
  readonly mergeBaseByCommit?: ReadonlyMap<string, string> | undefined;
  readonly receipts?: readonly ImpactReceipt[] | undefined;
};

type PrRestackEvidence = {
  readonly mergeBases: ReadonlyMap<string, string>;
  readonly staleBlockedByPr: ReadonlyMap<number, ReadonlySet<string>>;
};

function buildPrRestackEvidence(
  options?: SummarizePrOptions,
): PrRestackEvidence {
  const mergeBases = new Map<string, string>();
  const staleBlockedMutable = new Map<number, Set<string>>();
  for (const receipt of options?.receipts ?? []) {
    mergeBases.set(receipt.headSha, receipt.mergeBaseSha);
    if (receipt.verdict === "stale_overlap" && !receipt.bypassed) {
      const blocked = staleBlockedMutable.get(receipt.pr) ?? new Set<string>();
      blocked.add(receipt.headSha);
      staleBlockedMutable.set(receipt.pr, blocked);
    }
  }
  for (const [commit, base] of options?.mergeBaseByCommit ?? []) {
    mergeBases.set(commit, base);
  }
  return { mergeBases, staleBlockedByPr: staleBlockedMutable };
}

function isConfirmedRestackAdvance(options: {
  readonly prevHead: string;
  readonly prevBase: string | null;
  readonly nextBase: string | null;
  readonly staleBlockedHeads: ReadonlySet<string>;
  readonly consumedBlockedHeads: Set<string>;
}): boolean {
  if (options.prevBase !== null && options.nextBase !== null) {
    return options.nextBase !== options.prevBase;
  }
  if (
    options.staleBlockedHeads.has(options.prevHead) &&
    !options.consumedBlockedHeads.has(options.prevHead)
  ) {
    options.consumedBlockedHeads.add(options.prevHead);
    return true;
  }
  return false;
}

function isFailedRunStatus(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized === "failure" || normalized === "error";
}

function analyzeAfterFirstGreen(
  firstGreen: WoodpeckerPipelineItem,
  laterRuns: readonly WoodpeckerPipelineItem[],
  staleBlockedHeads: ReadonlySet<string>,
  resolveBase: (run: WoodpeckerPipelineItem) => string | null,
): {
  readonly confirmedRestackCount: number;
  readonly caughtFailureOnRestack: boolean;
} {
  const consumedBlockedHeads = new Set<string>();
  let currentHead = firstGreen.commit;
  let currentBase = resolveBase(firstGreen);
  let currentHeadIsRestack = false;
  let confirmedRestackCount = 0;
  let caughtFailureOnRestack = false;

  for (const run of laterRuns) {
    if (run.commit === currentHead) {
      caughtFailureOnRestack ||=
        currentHeadIsRestack && isFailedRunStatus(run.status);
      continue;
    }
    const nextBase = resolveBase(run);
    const isRestack = isConfirmedRestackAdvance({
      prevHead: currentHead,
      prevBase: currentBase,
      nextBase,
      staleBlockedHeads,
      consumedBlockedHeads,
    });
    currentHead = run.commit;
    currentBase = nextBase ?? (isRestack ? null : currentBase);
    currentHeadIsRestack = isRestack;
    if (isRestack) {
      confirmedRestackCount += 1;
      caughtFailureOnRestack ||= isFailedRunStatus(run.status);
    }
  }
  return { confirmedRestackCount, caughtFailureOnRestack };
}

function analyzeSinglePrRuns(
  pr: number,
  runs: readonly WoodpeckerPipelineItem[],
  evidence: PrRestackEvidence,
): {
  readonly sawGreen: boolean;
  readonly confirmedRestackCount: number;
  readonly caughtFailureOnRestack: boolean;
} {
  const ordered = [...runs].sort((a, b) => a.number - b.number);
  const firstGreenIdx = ordered.findIndex(
    (run) => run.status.toLowerCase() === "success",
  );
  const firstGreen = ordered[firstGreenIdx];
  if (firstGreenIdx === -1 || firstGreen === undefined) {
    return {
      sawGreen: false,
      confirmedRestackCount: 0,
      caughtFailureOnRestack: false,
    };
  }
  const staleBlockedHeads =
    evidence.staleBlockedByPr.get(pr) ?? new Set<string>();
  const resolveBase = (run: WoodpeckerPipelineItem): string | null =>
    run.mergeBaseSha ?? evidence.mergeBases.get(run.commit) ?? null;
  return {
    sawGreen: true,
    ...analyzeAfterFirstGreen(
      firstGreen,
      ordered.slice(firstGreenIdx + 1),
      staleBlockedHeads,
      resolveBase,
    ),
  };
}

export function summarizePrPipelines(
  pipelines: readonly WoodpeckerPipelineItem[],
  options?: SummarizePrOptions,
): ImpactScorecard["pullRequests"] {
  const byPr = groupReadyPipelinesByPr(pipelines);
  const evidence = buildPrRestackEvidence(options);
  let prsWithGreenHead = 0;
  let postGreenRestackedPrs = 0;
  let twoPlusRestackedPrs = 0;
  let skewsCaughtOnRestack = 0;

  for (const [pr, runs] of byPr.entries()) {
    const outcome = analyzeSinglePrRuns(pr, runs, evidence);
    if (!outcome.sawGreen) continue;
    prsWithGreenHead += 1;
    if (outcome.confirmedRestackCount > 0) postGreenRestackedPrs += 1;
    if (outcome.confirmedRestackCount >= 2) twoPlusRestackedPrs += 1;
    if (outcome.caughtFailureOnRestack) skewsCaughtOnRestack += 1;
  }

  return {
    evaluatedPrs: byPr.size,
    prsWithGreenHead,
    postGreenRestackedPrs,
    postGreenRestackRate:
      prsWithGreenHead > 0 ? postGreenRestackedPrs / prsWithGreenHead : 0,
    twoPlusRestackedPrs,
    twoPlusRestackRate:
      prsWithGreenHead > 0 ? twoPlusRestackedPrs / prsWithGreenHead : 0,
    skewsCaughtOnRestack,
  };
}

export function parseReceiptsContent(
  content: string,
  sinceMs: number,
  untilMs: number,
): ImpactReceipt[] {
  const results: ImpactReceipt[] = [];
  for (const rawLine of content.split("\n")) {
    const trimmed = rawLine.trim();
    if (trimmed === "") continue;
    const parsed = ImpactReceiptSchema.safeParse(JSON.parse(trimmed));
    if (!parsed.success) continue;
    const ts = Date.parse(parsed.data.timestamp);
    if (Number.isFinite(ts) && ts >= sinceMs && ts <= untilMs) {
      results.push(parsed.data);
    }
  }
  return results;
}

export function summarizeReceipts(
  receipts: readonly ImpactReceipt[],
  available: boolean,
  receiptPath: string,
): ImpactScorecard["receipts"] {
  let upToDate = 0;
  let disjointClean = 0;
  let staleBlocked = 0;
  let staleBypassed = 0;
  const blocksByPr = new Map<number, number>();

  for (const item of receipts) {
    if (item.verdict === "up_to_date") upToDate += 1;
    else if (item.verdict === "disjoint_clean") disjointClean += 1;
    else if (item.bypassed) staleBypassed += 1;
    else {
      staleBlocked += 1;
      blocksByPr.set(item.pr, (blocksByPr.get(item.pr) ?? 0) + 1);
    }
  }

  const prsWithTwoPlusStaleBlocks = [...blocksByPr.values()].filter(
    (count) => count >= 2,
  ).length;

  return {
    available,
    path: receiptPath,
    totalEvaluations: receipts.length,
    upToDate,
    disjointClean,
    staleBlocked,
    staleBypassed,
    staleBlockRate: receipts.length > 0 ? staleBlocked / receipts.length : 0,
    prsWithTwoPlusStaleBlocks,
  };
}

export function evaluateThresholds(input: {
  readonly main: ImpactScorecard["main"];
  readonly pullRequests: ImpactScorecard["pullRequests"];
  readonly receipts: ImpactScorecard["receipts"];
}): ImpactScorecard["decision"] {
  const effectiveRestackRate = Math.max(
    input.pullRequests.postGreenRestackRate,
    input.receipts.staleBlockRate,
  );
  const rollbackReasons: string[] = [];
  if (effectiveRestackRate > THRESHOLDS.rollbackMinPostGreenRestackRate) {
    rollbackReasons.push(
      `Post-green stale block/restack rate ${(effectiveRestackRate * 100).toFixed(1)}% exceeds >35.0% rollback trigger`,
    );
  }
  if (
    input.pullRequests.twoPlusRestackRate >=
    THRESHOLDS.rollbackMinTwoPlusRestackRate
  ) {
    rollbackReasons.push(
      `>=2-restack rate ${(input.pullRequests.twoPlusRestackRate * 100).toFixed(1)}% hit >=5.0% rollback trigger`,
    );
  }
  if (rollbackReasons.length > 0) {
    return {
      verdict: "ROLLBACK",
      reasons: rollbackReasons,
      rollbackActions: [
        "Pass `toolkit pr land --allow-stale-base` immediately for blocked merges",
        "Revert the merge-time stale-base check in `packages/toolkit/src/commands/pr/land.ts` and `packages/justin-principal-engineer/src/reconcile-merge.ts`",
      ],
    };
  }
  const keepMet =
    effectiveRestackRate < THRESHOLDS.keepMaxPostGreenRestackRate &&
    input.pullRequests.twoPlusRestackRate <
      THRESHOLDS.keepMaxTwoPlusRestackRate &&
    input.main.verifyOnsetsPerDay <= THRESHOLDS.keepMaxVerifyOnsetsPerDay;
  if (keepMet && input.pullRequests.prsWithGreenHead >= 5) {
    return {
      verdict: "KEEP",
      reasons: [
        `main verify onset rate ${input.main.verifyOnsetsPerDay.toFixed(2)}/day <= ${THRESHOLDS.keepMaxVerifyOnsetsPerDay.toFixed(2)}/day keep threshold (baseline ${NOV_10_23_BASELINE.verifyOnsetsPerDay.toFixed(2)}/day total, ${NOV_10_23_BASELINE.staleSkewIncidentsPerDay.toFixed(2)}/day skew)`,
        `post-green restack/block rate ${(effectiveRestackRate * 100).toFixed(1)}% < 25.0% keep threshold`,
        `>=2-restack rate ${(input.pullRequests.twoPlusRestackRate * 100).toFixed(1)}% < 3.0% keep threshold`,
      ],
      rollbackActions: [],
    };
  }
  return {
    verdict: "MONITOR",
    reasons: [
      `No rollback trigger crossed (effective restack/block rate ${(effectiveRestackRate * 100).toFixed(1)}%, >=2-restack rate ${(input.pullRequests.twoPlusRestackRate * 100).toFixed(1)}%, main verify onsets ${input.main.verifyOnsetsPerDay.toFixed(2)}/day across ${String(input.pullRequests.prsWithGreenHead)} green PRs)`,
    ],
    rollbackActions: [],
  };
}
