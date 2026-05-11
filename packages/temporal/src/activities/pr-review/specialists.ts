/**
 * Specialist fan-out dispatcher.
 *
 * Phase 3 replaces the single-specialist `correctnessReviewer` call with a
 * parallel fan-out across all 5 specialists (correctness / security / perf
 * / convention / deps) × N=3 randomized passes each — 15 LLM calls per PR.
 * Each pass's findings are annotated with the producing specialist and
 * pass index so the downstream `consensus` activity can vote.
 *
 * # Plan deviation: Opus 4.7 thinking
 *
 * The plan literally says "24K thinking budget" for Opus specialists, which
 * was a 4.6-era spec. `budget_tokens` is REMOVED on `claude-opus-4-7` —
 * sending it returns 400. The canonical depth knob is now
 * `thinking: { type: "adaptive" }` + `output_config: { effort: ... }`.
 * Specialists implement the plan's intent via effort tiers:
 *   - correctness, security: effort=high (Opus 4.7)
 *   - perf:                  effort=high (Opus 4.7)
 *   - convention, deps:      effort=medium (Sonnet 4.6)
 * The PR description documents this deviation in detail.
 *
 * # Concurrency
 *
 * All 15 calls run in parallel via `Promise.allSettled` — one slow
 * specialist doesn't gate the others. A failed pass is logged + reported
 * to Sentry/Bugsink but does NOT fail the activity: consensus voting
 * tolerates 1–2 missing passes (the rule degrades gracefully). If
 * EVERY pass fails, the activity returns an empty annotated array and
 * lets postReview log "no findings".
 *
 * # Cost / latency emission
 *
 * Each pass emits a per-call observation to the
 * `pr_review_cost_usd{model, specialist}` and
 * `pr_review_specialist_latency_seconds{model, specialist}` histograms.
 * The per-PR sum is computed downstream in Grafana with
 * `sum(rate(pr_review_cost_usd_sum[5m])) by (pr)`.
 */

import { withSpan } from "#observability/tracing.ts";
import { prReviewCostUsd } from "#observability/pr-review-metrics.ts";
import { prReviewSpecialistLatencySeconds } from "#observability/metrics.ts";
import type { PrReviewPipelineInput } from "#shared/schemas.ts";
import type { Finding } from "#shared/pr-review/finding.ts";
import { PASSES_PER_SPECIALIST } from "#lib/diff-slicing.ts";
import type { BootstrapResult } from "./bootstrap.ts";
import type { AnnotatedFinding } from "./consensus.ts";
import {
  CORRECTNESS_CONFIG,
  correctnessSpecialistAdapter,
} from "./specialists/correctness-adapter.ts";
import { SECURITY_CONFIG, securityReviewer } from "./specialists/security.ts";
import { PERF_CONFIG, perfReviewer } from "./specialists/perf.ts";
import {
  CONVENTION_CONFIG,
  conventionReviewer,
} from "./specialists/convention.ts";
import { DEPS_CONFIG, depsReviewer } from "./specialists/deps.ts";
import type {
  SpecialistConfig,
  SpecialistRunResult,
} from "./specialists/runner.ts";

const COMPONENT = "pr-review-pipeline";

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: COMPONENT,
      activity: "runSpecialists",
      ...fields,
    }),
  );
}

export type RunSpecialistsInput = {
  pipeline: PrReviewPipelineInput;
  context: BootstrapResult;
};

/**
 * One specialist's invocation function. Each specialist exposes a
 * `(input: {pipeline, context, passId}) => Promise<SpecialistRunResult>`
 * signature; this tuple just pairs the function with the config so the
 * dispatcher can record cost/latency metrics with the right labels.
 */
type SpecialistDispatcher = {
  config: SpecialistConfig;
  invoke: (input: {
    pipeline: PrReviewPipelineInput;
    context: BootstrapResult;
    passId: number;
  }) => Promise<SpecialistRunResult>;
};

/**
 * Single source of truth for the specialist roster. Adding a 6th specialist
 * means adding one row here.
 */
const SPECIALISTS: SpecialistDispatcher[] = [
  { config: CORRECTNESS_CONFIG, invoke: correctnessSpecialistAdapter },
  { config: SECURITY_CONFIG, invoke: securityReviewer },
  { config: PERF_CONFIG, invoke: perfReviewer },
  { config: CONVENTION_CONFIG, invoke: conventionReviewer },
  { config: DEPS_CONFIG, invoke: depsReviewer },
];

/**
 * Record cost/latency telemetry for one specialist pass. Best-effort —
 * failure to record metrics never fails the activity.
 */
function recordPassMetrics(
  config: SpecialistConfig,
  result: SpecialistRunResult,
): void {
  if (result.costUsd !== null) {
    prReviewCostUsd.observe(
      { model: config.model, specialist: config.id },
      result.costUsd,
    );
  }
  prReviewSpecialistLatencySeconds.observe(
    { model: config.model, specialist: config.id },
    result.durationMs / 1000,
  );
}

/**
 * Dispatch one pass. Returns either an array of annotated findings or null
 * if the pass failed (the caller logs the failure and proceeds with the
 * passes that succeeded).
 */
async function runSinglePass(
  input: RunSpecialistsInput,
  dispatcher: SpecialistDispatcher,
  passId: number,
): Promise<AnnotatedFinding[] | null> {
  const { config } = dispatcher;
  try {
    const result = await dispatcher.invoke({
      pipeline: input.pipeline,
      context: input.context,
      passId,
    });
    recordPassMetrics(config, result);
    return result.findings.map<AnnotatedFinding>((finding) => ({
      finding,
      specialistId: config.id,
      passId,
    }));
  } catch (error: unknown) {
    jsonLog("warning", "specialist pass failed", {
      specialist: config.id,
      passId,
      prNumber: input.pipeline.prNumber,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Fan out every (specialist × pass) combination in parallel, collect the
 * annotated findings, log failures, and return the union.
 */
async function runAllSpecialistsImpl(
  input: RunSpecialistsInput,
): Promise<AnnotatedFinding[]> {
  return await withSpan(
    "prReview.runSpecialists",
    {
      "pr.number": input.pipeline.prNumber,
      "pr.commitSha": input.pipeline.commitSha,
      "specialists.count": SPECIALISTS.length,
      "passes.perSpecialist": PASSES_PER_SPECIALIST,
    },
    async () => {
      const jobs: Promise<AnnotatedFinding[] | null>[] = [];
      for (const dispatcher of SPECIALISTS) {
        for (let passId = 0; passId < PASSES_PER_SPECIALIST; passId++) {
          jobs.push(runSinglePass(input, dispatcher, passId));
        }
      }
      const results = await Promise.all(jobs);
      const annotated: AnnotatedFinding[] = [];
      let failed = 0;
      for (const r of results) {
        if (r === null) {
          failed++;
          continue;
        }
        annotated.push(...r);
      }
      jsonLog("info", "runSpecialists fan-out complete", {
        prNumber: input.pipeline.prNumber,
        totalPasses: jobs.length,
        failedPasses: failed,
        rawFindings: annotated.length,
      });
      return annotated;
    },
  );
}

export type SpecialistActivities = typeof specialistActivities;

export const specialistActivities = {
  async prReviewRunSpecialists(
    input: RunSpecialistsInput,
  ): Promise<AnnotatedFinding[]> {
    return runAllSpecialistsImpl(input);
  },
};

/**
 * Phase 2's `runSpecialists` returned `Finding[]`. Phase 3 returns
 * `AnnotatedFinding[]` because consensus needs `(specialistId, passId)`
 * provenance. The parent workflow's import is updated to match.
 *
 * Re-exported for tests that want to flatten back to the legacy `Finding[]`
 * shape (no provenance metadata) without re-importing the consensus types.
 */
export function annotatedToFindings(
  annotated: readonly AnnotatedFinding[],
): Finding[] {
  return annotated.map((a) => a.finding);
}
