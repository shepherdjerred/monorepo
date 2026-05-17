import { proxyActivities, workflowInfo } from "@temporalio/workflow";
import type {
  BootstrapResult,
  BootstrapActivities,
} from "#activities/pr-review/bootstrap.ts";
import type { DeterministicSignalActivities } from "#activities/pr-review/deterministic-signals.ts";
import type { SpecialistActivities } from "#activities/pr-review/specialists.ts";
import type { ConsensusActivities } from "#activities/pr-review/consensus.ts";
import type { VerifyActivities } from "#activities/pr-review/verify.ts";
import type { DedupeActivities } from "#activities/pr-review/dedupe.ts";
import type {
  PostActivities,
  PostReviewResult,
} from "#activities/pr-review/post.ts";
import type { MetricsActivities } from "#activities/pr-review/metrics.ts";
import type { TrackActivities } from "#activities/pr-review/track.ts";
import type { PrReviewPipelineInput } from "#shared/schemas.ts";
import type { Finding } from "#shared/pr-review/finding.ts";
import type { AnnotatedFinding } from "#activities/pr-review/consensus.ts";

/**
 * Activity timeouts and retry policies for the pr-review pipeline.
 *
 * - `bootstrap`: clones + setup, can take a couple of minutes. Retry once
 *   to absorb transient git failures.
 * - `runSpecialists`: LLM-bound. Long enough for 5 specialists × 3 passes.
 *   No retry — the activity itself fans out and retries per-specialist.
 * - `consensus`/`verify`/`dedupe`/`metrics`/`track`: fast, in-process or
 *   single-network-call. Tight timeouts, single retry.
 * - `post`: GitHub API. Retry generously to ride out rate limits.
 */
const bootstrap = proxyActivities<BootstrapActivities>({
  startToCloseTimeout: "10 minutes",
  heartbeatTimeout: "30 seconds",
  retry: { maximumAttempts: 2 },
});

const deterministicSignals = proxyActivities<DeterministicSignalActivities>({
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 2 },
});

const specialists = proxyActivities<SpecialistActivities>({
  startToCloseTimeout: "30 minutes",
  heartbeatTimeout: "1 minute",
  retry: { maximumAttempts: 1 },
});

const consensus = proxyActivities<ConsensusActivities>({
  startToCloseTimeout: "1 minute",
  retry: { maximumAttempts: 2 },
});

const verify = proxyActivities<VerifyActivities>({
  startToCloseTimeout: "10 minutes",
  heartbeatTimeout: "30 seconds",
  retry: { maximumAttempts: 1 },
});

const dedupe = proxyActivities<DedupeActivities>({
  startToCloseTimeout: "1 minute",
  retry: { maximumAttempts: 2 },
});

const post = proxyActivities<PostActivities>({
  startToCloseTimeout: "2 minutes",
  retry: {
    maximumAttempts: 5,
    initialInterval: "10 seconds",
    maximumInterval: "2 minutes",
  },
});

const metrics = proxyActivities<MetricsActivities>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 2 },
});

const track = proxyActivities<TrackActivities>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 2 },
});

export type PrReviewPipelineResult = {
  postedFindings: number;
  commentId: number;
  created: boolean;
  inlineReviewId: number | null;
  inlineCommentsPosted: number;
  inlineCommentsSkippedUnanchored: number;
  inlineCommentsSkippedDuplicate: number;
  inlineCommentsFailed: boolean;
};

async function postLifecycleStatus(
  input: PrReviewPipelineInput,
  state: "running" | "failed",
  reason?: string,
): Promise<void> {
  try {
    const statusInput =
      reason === undefined
        ? {
            pipeline: input,
            state,
            workflowId: workflowInfo().workflowId,
          }
        : {
            pipeline: input,
            state,
            reason,
            workflowId: workflowInfo().workflowId,
          };
    await post.prReviewPostStatus({
      ...statusInput,
    });
  } catch {
    // Best-effort visibility only. Preserve the main review pipeline result
    // or original failure instead of replacing it with a status-comment error.
  }
}

/**
 * Parent workflow orchestrating the SOTA PR review pipeline. Phase 1 wires
 * the activity graph end-to-end with stub activities; subsequent phases
 * replace each stub with its real implementation. See
 * `packages/docs/plans/2026-05-10_sota-pr-review-bot.md`.
 *
 * Phase 8 emit-site wiring: the workflow now records `startedAtMs` from
 * `workflowInfo().startTime` (deterministic), tracks per-stage finding
 * counts for drop-rate gauges, and fires the lifecycle counter with the
 * appropriate `status` label (posted | failed). Cost-per-model is
 * intentionally empty until the specialists activity (Phase 3) returns
 * cost data alongside findings.
 */
export async function prReviewPipeline(
  input: PrReviewPipelineInput,
): Promise<PrReviewPipelineResult> {
  // Deterministic workflow-start timestamp. Safe to use inside a workflow
  // because Temporal persists `workflowInfo().startTime` in history and
  // replays return the same value.
  const startedAtMs = workflowInfo().startTime.getTime();

  try {
    await postLifecycleStatus(input, "running");

    const context: BootstrapResult = await bootstrap.prReviewBootstrap(input);

    const [machineFindings, specialistFindings] = await Promise.all([
      deterministicSignals.prReviewDeterministicSignals({ context }),
      specialists.prReviewRunSpecialists({
        pipeline: input,
        context,
      }),
    ]);
    const annotatedFindings: AnnotatedFinding[] = [
      ...machineFindings,
      ...specialistFindings,
    ];

    const consensusFindings: Finding[] = await consensus.prReviewConsensus({
      annotated: annotatedFindings,
    });

    const verifiedFindings: Finding[] = await verify.prReviewVerify({
      findings: consensusFindings,
      workdir: context.workdir,
    });

    const dedupedFindings: Finding[] = await dedupe.prReviewDedupe({
      owner: input.owner,
      repo: input.repo,
      findings: verifiedFindings,
    });

    const postResult: PostReviewResult = await post.prReviewPost({
      pipeline: input,
      findings: dedupedFindings,
      changedFiles: context.changedFiles,
    });

    await metrics.prReviewEmitMetrics({
      owner: input.owner,
      repo: input.repo,
      postedFindings: dedupedFindings.length,
      created: postResult.created,
      status: "posted",
      startedAtMs,
      // TODO(specialists Phase 3): populate from runSpecialists return value
      // once the activity surfaces per-call cost-by-model. For now, the
      // pr_review_cost_usd histogram simply has no samples — preferable to
      // emitting a fake value.
      costs: [],
      stageDrops: {
        consensusInput: annotatedFindings.length,
        consensusOutput: consensusFindings.length,
        verificationOutput: verifiedFindings.length,
        dedupeOutput: dedupedFindings.length,
      },
    });

    await track.prReviewTrack({
      pipeline: input,
      findings: dedupedFindings,
      postResult,
    });

    return {
      postedFindings: dedupedFindings.length,
      commentId: postResult.commentId,
      created: postResult.created,
      inlineReviewId: postResult.inlineReviewId,
      inlineCommentsPosted: postResult.inlineCommentsPosted,
      inlineCommentsSkippedUnanchored:
        postResult.inlineCommentsSkippedUnanchored,
      inlineCommentsSkippedDuplicate: postResult.inlineCommentsSkippedDuplicate,
      inlineCommentsFailed: postResult.inlineCommentsFailed,
    };
  } catch (error: unknown) {
    // Best-effort failure-metrics emission. If this itself throws we still
    // want the original error to surface; swallow only the secondary error.
    const reason =
      error instanceof Error ? `${error.name}: ${error.message}` : "unknown";
    try {
      await metrics.prReviewEmitFailureMetrics({
        owner: input.owner,
        repo: input.repo,
        startedAtMs,
        reason,
      });
    } catch {
      // Intentionally swallowed — preserve the original error.
    }
    await postLifecycleStatus(input, "failed", reason);
    throw error;
  }
}
