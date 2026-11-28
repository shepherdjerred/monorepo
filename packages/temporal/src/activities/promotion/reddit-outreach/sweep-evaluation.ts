import {
  StructuredOutputUsageError,
  type AggregateLlmUsage,
} from "@shepherdjerred/llm-runtime";
import type {
  RedditOutreachMetrics,
  RedditOutreachReason,
} from "@shepherdjerred/ops-model/promotion/reddit-outreach.ts";
import { reservePromotionAi } from "#activities/promotion/control/budget.ts";
import {
  REDDIT_MATCH_THRESHOLD,
  type RedditQualification,
} from "#activities/promotion/reddit-discovery/decisions.ts";
import type { RedditRequestPost } from "#activities/promotion/reddit-discovery/model.ts";
import { draftRedditInvite } from "#activities/promotion/reddit-discovery/relevance.ts";
import { REDDIT_SERVER_FACTS } from "#activities/promotion/reddit-facts.ts";
import type { PromotionStore } from "#activities/promotion/store.ts";

export function countReason(
  { metrics: { reasons } }: { metrics: RedditOutreachMetrics },
  reason: RedditOutreachReason,
) {
  reasons[reason] = (reasons[reason] ?? 0) + 1;
}

export function countDecisionRejections(
  summary: { metrics: RedditOutreachMetrics },
  qualification: RedditQualification | undefined,
) {
  const reasons =
    qualification === undefined
      ? []
      : (
          [
            !qualification.explicitlySeekingServer && "intent-unconfirmed",
            !qualification.communityAllowsReply && "rules-exclude-replies",
            !qualification.hardConstraintsSatisfied &&
              "requirements-unconfirmed",
            qualification.judgeScore < REDDIT_MATCH_THRESHOLD &&
              "score-too-low",
          ] as const
        ).filter((reason) => reason !== false);
  if (reasons.length === 0) countReason(summary, "decision-declined");
  for (const reason of reasons) countReason(summary, reason);
}

function recordDraftUsage(usage: AggregateLlmUsage | null) {
  return {
    inputTokens: usage?.tokens.input ?? 0,
    cachedInputTokens: usage?.tokens.cachedInput ?? 0,
    cacheWriteInputTokens: usage?.tokens.cacheWrite ?? 0,
    outputTokens: usage?.tokens.output ?? 0,
    reasoningTokens: usage?.tokens.reasoning ?? 0,
  };
}

export async function draftCandidate(input: {
  store: PromotionStore;
  signal: AbortSignal;
  occurrenceId: string;
  config: { model: string; dailySpendUsd: number };
  post: RedditRequestPost;
  rules: string;
  qualification: RedditQualification;
}) {
  const { store, signal, occurrenceId, config, post, rules, qualification } =
    input;
  signal.throwIfAborted();
  const record = await reservePromotionAi(
    store,
    `${occurrenceId}/draft/${post.id}`,
    config,
  );
  try {
    const result = await draftRedditInvite({
      post,
      qualification,
      model: config.model,
      signal,
      communityRules: rules,
      serverFacts: REDDIT_SERVER_FACTS,
    });
    await record(recordDraftUsage(result.usage));
    return result.draft.reply;
  } catch (error) {
    if (error instanceof StructuredOutputUsageError)
      await record(recordDraftUsage(error.usage));
    throw error;
  }
}
