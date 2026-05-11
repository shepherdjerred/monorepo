/**
 * Activity that emits Prometheus gauges from a SignificanceReport +
 * exposes the active-experiment registry to workflows.
 *
 * Workflow code can't import the registry file directly because
 * `variant.ts` reaches into `node:crypto` for SHA-256 — using
 * non-deterministic APIs from a workflow violates Temporal's
 * determinism contract. Going through an activity keeps the registry
 * read inside a side-effect boundary.
 */
import { withSpan } from "#observability/tracing.ts";
import { ACTIVE_EXPERIMENTS } from "#shared/pr-review/variant.ts";
import {
  prReviewExperimentLabeledCount,
  prReviewExperimentPosteriorMean,
  prReviewExperimentReportsTotal,
  prReviewExperimentWinProbability,
} from "#observability/pr-review-experiment-metrics.ts";
import type { SignificanceReport } from "./significance.ts";

export type EmitExperimentMetricsInput = {
  report: SignificanceReport;
};

async function emitImpl(input: EmitExperimentMetricsInput): Promise<void> {
  await withSpan(
    "prReviewEval.emitExperimentMetrics",
    { "experiment.id": input.report.experimentId },
    () => {
      const { report } = input;
      // Per-variant gauges
      for (const arm of report.arms) {
        prReviewExperimentPosteriorMean.set(
          { experiment_id: report.experimentId, variant: arm.variant },
          arm.posteriorMean,
        );
        prReviewExperimentLabeledCount.set(
          { experiment_id: report.experimentId, variant: arm.variant },
          arm.labeledCount,
        );
        // `min_{u≠v} P(v > u)` — recomputed from pairwise table.
        let minBeats = 1;
        let comparisons = 0;
        for (const entry of report.pairwiseProbabilities) {
          if (entry.row !== arm.variant) {
            continue;
          }
          if (entry.col === arm.variant) {
            continue;
          }
          comparisons++;
          if (entry.p < minBeats) {
            minBeats = entry.p;
          }
        }
        prReviewExperimentWinProbability.set(
          { experiment_id: report.experimentId, variant: arm.variant },
          comparisons === 0 ? 1 : minBeats,
        );
      }
      // Workflow-health counter
      prReviewExperimentReportsTotal.inc({ outcome: "ok" });
      return Promise.resolve();
    },
  );
}

async function listImpl(): Promise<string[]> {
  return await withSpan("prReviewEval.listActiveExperimentIds", {}, () =>
    Promise.resolve(ACTIVE_EXPERIMENTS.map((e) => e.id)),
  );
}

export type EvalExperimentMetricsActivities =
  typeof evalExperimentMetricsActivities;

export const evalExperimentMetricsActivities = {
  async prReviewEmitExperimentMetrics(
    input: EmitExperimentMetricsInput,
  ): Promise<void> {
    return emitImpl(input);
  },
  async prReviewListActiveExperimentIds(): Promise<string[]> {
    return listImpl();
  },
};
