import { createHash } from "node:crypto";
import { z } from "zod/v4";
import {
  StructuredOutputUsageError,
  type AggregateLlmUsage,
} from "@shepherdjerred/llm-runtime";
import { reservePromotionAi } from "#activities/promotion/control/budget.ts";
import type { PromotionStore } from "#activities/promotion/store.ts";
import {
  DecisionHttpError,
  judgeRedditRequest,
  REDDIT_DECISIONS_MODEL,
  RedditQualificationSchema,
  type RedditJudgeInput,
  type RedditQualification,
} from "./decisions.ts";
import {
  REDDIT_OUTREACH_FACTS,
  REDDIT_OUTREACH_POLICY_VERSION,
} from "#activities/promotion/reddit-facts.ts";

const CacheSchema = z.strictObject({
  fingerprint: z.string(),
  qualification: RedditQualificationSchema,
});
type ScreenInput = { post: RedditJudgeInput["post"]; rules: string };
type ScoreResult = {
  qualification: RedditQualification;
  usage: AggregateLlmUsage;
};

export function redditAssessmentFingerprint({ post, rules }: ScreenInput) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        subreddit: post.subreddit.toLowerCase(),
        title: post.title,
        body: post.body,
        rules,
        facts: REDDIT_OUTREACH_FACTS,
        model: REDDIT_DECISIONS_MODEL,
        version: REDDIT_OUTREACH_POLICY_VERSION,
      }),
    )
    .digest("hex");
}

export async function screenRedditBatch(input: {
  items: readonly ScreenInput[];
  store: PromotionStore;
  reservationId: string;
  dailySpendUsd: number;
  signal: AbortSignal;
  cacheScope?: "thread";
  judge?: (input: RedditJudgeInput) => Promise<ScoreResult>;
}) {
  const { store, signal } = input;
  const checked = await Promise.all(
    input.items.map(async (item) => {
      const scope = input.cacheScope === "thread" ? "thread/" : "";
      const key = `reddit-outreach/decisions/${scope}${item.post.id}.json`;
      const fingerprint = redditAssessmentFingerprint(item);
      const current = await store.read(key, CacheSchema);
      return {
        ...item,
        key,
        fingerprint,
        current,
        cached:
          current?.value.fingerprint === fingerprint
            ? current.value.qualification
            : undefined,
      };
    }),
  );
  const pending = checked.filter((item) => item.cached === undefined);
  const cached = checked.flatMap((item) =>
    item.cached === undefined
      ? []
      : [{ post: item.post, qualification: item.cached }],
  );
  if (pending.length === 0)
    return { matches: cached, assessed: 0, cached: cached.length };
  signal.throwIfAborted();
  const record = await reservePromotionAi(store, input.reservationId, {
    model: REDDIT_DECISIONS_MODEL,
    dailySpendUsd: input.dailySpendUsd,
  });
  const judged = await Promise.allSettled(
    pending.map(async ({ post, rules }) =>
      (input.judge ?? judgeRedditRequest)({
        post,
        communityRules: rules,
        serverFacts: REDDIT_OUTREACH_FACTS,
        signal,
      }),
    ),
  );
  const charges = judged.map((result) => decisionUsage(result));
  if (charges.every((usage) => usage !== undefined))
    await record(addDecisionUsage(charges));
  const fresh = await Promise.all(
    pending.flatMap((item, index) => {
      const result = judged[index];
      if (result?.status !== "fulfilled") return [];
      return [
        (async () => {
          const { qualification } = result.value;
          if (
            !(await store.put(
              item.key,
              { fingerprint: item.fingerprint, qualification },
              item.current?.etag,
            ))
          )
            throw new Error("Concurrent Reddit Decisions cache update");
          return { post: item.post, qualification };
        })(),
      ];
    }),
  );
  const failure = judged.find((result) => result.status === "rejected");
  if (failure !== undefined) {
    const error: unknown = failure.reason;
    if (error instanceof Error) throw error;
    throw new Error("Unexpected Reddit Decisions failure", { cause: error });
  }
  return {
    matches: [...cached, ...fresh],
    assessed: fresh.length,
    cached: cached.length,
  };
}

function decisionUsage(
  result: PromiseSettledResult<ScoreResult>,
): AggregateLlmUsage | null | undefined {
  if (result.status === "fulfilled") return result.value.usage;
  const error: unknown = result.reason;
  if (error instanceof StructuredOutputUsageError) return error.usage;
  if (
    error instanceof DecisionHttpError &&
    [400, 401, 403, 404, 429].includes(error.status)
  )
    return null;
  // An ambiguous provider call keeps the spend reservation unresolved.
  return undefined;
}

function addDecisionUsage(
  charges: readonly (AggregateLlmUsage | null | undefined)[],
) {
  const tokens = charges.flatMap((charge) =>
    charge === null || charge === undefined ? [] : [charge.tokens],
  );
  return {
    inputTokens: tokens.reduce((sum, token) => sum + token.input, 0),
    cachedInputTokens: tokens.reduce(
      (sum, token) => sum + token.cachedInput,
      0,
    ),
    cacheWriteInputTokens: tokens.reduce(
      (sum, token) => sum + token.cacheWrite,
      0,
    ),
    // The Decisions endpoint charges only input tokens.
    outputTokens: 0,
    reasoningTokens: 0,
  };
}
