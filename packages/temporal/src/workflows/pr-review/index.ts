import { proxyActivities } from "@temporalio/workflow";
import type {
  BootstrapResult,
  BootstrapActivities,
} from "#activities/pr-review/bootstrap.ts";
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
};

/**
 * Parent workflow orchestrating the SOTA PR review pipeline. Phase 1 wires
 * the activity graph end-to-end with stub activities; subsequent phases
 * replace each stub with its real implementation. See
 * `packages/docs/plans/2026-05-10_sota-pr-review-bot.md`.
 */
export async function prReviewPipeline(
  input: PrReviewPipelineInput,
): Promise<PrReviewPipelineResult> {
  const context: BootstrapResult = await bootstrap.prReviewBootstrap(input);

  const rawFindings: Finding[] = await specialists.prReviewRunSpecialists({
    pipeline: input,
    context,
  });

  const consensusFindings: Finding[] =
    await consensus.prReviewConsensus(rawFindings);

  const verifiedFindings: Finding[] =
    await verify.prReviewVerify(consensusFindings);

  const dedupedFindings: Finding[] = await dedupe.prReviewDedupe({
    owner: input.owner,
    repo: input.repo,
    findings: verifiedFindings,
  });

  const postResult: PostReviewResult = await post.prReviewPost({
    pipeline: input,
    findings: dedupedFindings,
  });

  await metrics.prReviewEmitMetrics({
    owner: input.owner,
    repo: input.repo,
    postedFindings: dedupedFindings.length,
    created: postResult.created,
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
  };
}
