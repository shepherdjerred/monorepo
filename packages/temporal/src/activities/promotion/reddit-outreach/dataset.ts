import { isDeepStrictEqual } from "node:util";
import { redactSecrets } from "@shepherdjerred/llm-observability";
import {
  DecisionAnswerSchema,
  type DecisionAnswer,
} from "@shepherdjerred/llm-runtime";
import { z } from "zod/v4";
import { promotionSpendDay } from "#activities/promotion/control/budget.ts";
import {
  RedditFeedPostSchema,
  RedditLoadedCommentSchema,
  type RedditFeedPost,
  type RedditThreadSnapshot,
} from "#activities/promotion/reddit-discovery/browser-reader.ts";
import { RedditRequestPostSchema } from "#activities/promotion/reddit-discovery/model.ts";
import type { PromotionStore } from "#activities/promotion/store.ts";

export const REDDIT_DATASET_PREFIX = "reddit-outreach/dataset/v1";
const observationHeader = {
  schemaVersion: z.literal(1),
  occurrenceId: z.string().min(1),
  observedAt: z.iso.datetime(),
};
const listingPost = RedditFeedPostSchema.omit({ author: true });
const threadPost = RedditRequestPostSchema.omit({
  author: true,
  loggedInUsername: true,
  ownReplyIds: true,
});
const decisionFields = {
  postId: RedditRequestPostSchema.shape.id,
  capturedAt: z.iso.datetime(),
  model: z.string().min(1),
  communityRules: z.string().min(1),
  approvedServerFacts: z.string().min(1),
  answers: z.array(DecisionAnswerSchema).nullable(),
};
export const RedditDatasetObservationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...observationHeader,
    kind: z.literal("listing"),
    subreddit: RedditFeedPostSchema.shape.subreddit,
    posts: z.array(listingPost).max(100),
  }),
  z.strictObject({
    ...observationHeader,
    kind: z.literal("thread"),
    post: threadPost,
    comments: z.array(RedditLoadedCommentSchema),
  }),
  z.strictObject({
    ...observationHeader,
    ...decisionFields,
    kind: z.literal("decision"),
  }),
]);
type Observation = z.infer<typeof RedditDatasetObservationSchema>;
type DecisionCapture = Omit<
  z.infer<z.ZodObject<typeof decisionFields>>,
  "answers"
> & { answers: readonly DecisionAnswer[] | null };

export class RedditDatasetStorageError extends Error {}

async function writeObservation(
  store: PromotionStore,
  signal: AbortSignal,
  key: string,
  observation: Observation,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    const attemptSignal = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
    try {
      if (await store.put(key, observation, undefined, attemptSignal)) return;
      const existing = await store.read(
        key,
        RedditDatasetObservationSchema,
        attemptSignal,
      );
      if (existing === undefined) continue;
      if (isDeepStrictEqual(existing.value, observation)) return;
      throw new RedditDatasetStorageError(
        `Conflicting Reddit dataset observation at ${key}`,
      );
    } catch (error) {
      if (error instanceof RedditDatasetStorageError) throw error;
      lastError = error;
    }
  }
  throw new RedditDatasetStorageError(
    `Unable to archive Reddit dataset observation at ${key}`,
    {
      cause: lastError,
    },
  );
}

export function createRedditDatasetArchive(input: {
  store: PromotionStore;
  signal: AbortSignal;
  occurrenceId: string;
  preview: boolean;
  now?: () => Date;
}) {
  const { store, signal, occurrenceId } = input;
  const mode = input.preview ? "preview" : "live";
  const run = `mode=${mode}/run=${encodeURIComponent(occurrenceId)}`;
  const sequence = { listings: 0, threads: 0, decisions: 0 };
  async function record(
    value:
      | Omit<
          Extract<Observation, { kind: "listing" }>,
          keyof typeof observationHeader
        >
      | Omit<
          Extract<Observation, { kind: "thread" }>,
          keyof typeof observationHeader
        >
      | (DecisionCapture & { kind: "decision" }),
  ) {
    const stream = `${value.kind}s` as const;
    const ordinal = String(++sequence[stream]).padStart(6, "0");
    const observedAt = input.now?.() ?? new Date();
    const day = promotionSpendDay(observedAt);
    const observation = RedditDatasetObservationSchema.parse(
      redactSecrets({
        schemaVersion: 1,
        occurrenceId,
        observedAt: observedAt.toISOString(),
        ...value,
      }),
    );
    await writeObservation(
      store,
      signal,
      `${REDDIT_DATASET_PREFIX}/day=${day}/${run}/${stream}/${ordinal}.json`,
      observation,
    );
  }
  return {
    listing(subreddit: string, posts: readonly RedditFeedPost[]) {
      return record({
        kind: "listing",
        subreddit,
        posts: posts.map(({ author: _author, ...post }) => post),
      });
    },
    thread({ post, comments }: RedditThreadSnapshot) {
      const {
        author: _author,
        loggedInUsername: _session,
        ownReplyIds: _own,
        ...visible
      } = post;
      return record({ kind: "thread", post: visible, comments });
    },
    decision: ({
      post,
      ...details
    }: Omit<DecisionCapture, "postId"> & {
      post: { id: string };
    }) =>
      record({
        kind: "decision",
        postId: post.id,
        ...details,
      }),
  };
}

export type RedditDatasetArchive = ReturnType<
  typeof createRedditDatasetArchive
>;
