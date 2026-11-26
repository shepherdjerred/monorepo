import { readdir } from "node:fs/promises";
import path from "node:path";
import { DecisionAnswerSchema } from "@shepherdjerred/llm-runtime";
import {
  RedditOutreachCoverageSchema,
  RedditOutreachPostSchema,
} from "@shepherdjerred/ops-model/promotion/reddit-outreach.ts";
import { RedditQualificationSchema } from "#activities/promotion/reddit-discovery/decisions.ts";
import { RedditDatasetObservationSchema } from "#activities/promotion/reddit-outreach/dataset.ts";
import { z, type ZodType } from "zod/v4";

const PostId = z.string().regex(/^[a-z0-9]+$/u);
const Instant = z.iso.datetime({ offset: true });
const Label = z.enum(["eligible", "ineligible", "uncertain", "duplicate"]);
const EvidencePost = z.object({
  subreddit: z.string(),
  title: z.string(),
  body: z.string(),
});
const Decision = z.object({
  postId: PostId.nullable(),
  occurrenceId: z.string().optional(),
  capturedAt: Instant,
  observedAt: Instant.optional(),
  model: z.string(),
  answers: z.array(DecisionAnswerSchema),
});
const SnapshotThread = z.object({
  postId: PostId,
  subreddit: z.string(),
  result: RedditOutreachPostSchema.shape.result,
  review: z.object({ label: z.string() }).optional(),
});
const SnapshotReply = z.object({
  postId: PostId,
  sourceUrl: z.url(),
  relation: z.enum(["the_storm", "other_server"]),
  status: z.string().optional(),
});
const Review = z.object({
  postId: PostId,
  label: Label,
  requestId: z.string().min(1).optional(),
});
const Draft = z
  .object({
    postId: PostId,
    post: EvidencePost.extend({ id: PostId }),
    qualification: RedditQualificationSchema,
    communityRules: z.string(),
    serverFacts: z.string(),
    model: z.string(),
    draft: z.unknown(),
  })
  .refine(({ postId, post }) => postId === post.id, "Draft post IDs differ");
const Audit = z.object({
  occurrenceId: z.string(),
  completedAt: Instant,
  preview: z.boolean(),
  posts: z.array(RedditOutreachPostSchema).optional(),
  replies: z.array(
    z.object({
      postId: PostId,
      status: z.string(),
      receiptUrl: z.url().optional(),
    }),
  ),
  coverage: z.array(RedditOutreachCoverageSchema).optional(),
});

export type ReplayInputs = Awaited<ReturnType<typeof loadReplayInputs>>;
export type ReplayReview = z.infer<typeof Review>;

async function readRows<T>(filePath: string, schema: ZodType<T>): Promise<T[]> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return [];
  const content = await file.text();
  return content.split("\n").flatMap((line, index) => {
    if (line.trim() === "") return [];
    try {
      return [schema.parse(JSON.parse(line))];
    } catch (error) {
      throw new Error(`Invalid input at ${filePath}:${String(index + 1)}`, {
        cause: error,
      });
    }
  });
}

async function readObjects<T>(directory: string, schema: ZodType<T>) {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  }).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw error;
  });
  const objects: T[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(entry.parentPath, entry.name);
    try {
      objects.push(schema.parse(await Bun.file(filePath).json()));
    } catch (error) {
      throw new Error(`Invalid input at ${filePath}`, { cause: error });
    }
  }
  return objects;
}

export async function loadReplayInputs(directory: string) {
  const manifest = Bun.file(path.join(directory, "manifest.json"));
  const [
    metadata,
    threads,
    replies,
    decisions,
    reviews,
    drafts,
    observations,
    audits,
  ] = await Promise.all([
    manifest
      .exists()
      .then(async (exists) =>
        exists
          ? z.object({ date: z.iso.date() }).parse(await manifest.json())
          : undefined,
      ),
    readRows(path.join(directory, "threads.jsonl"), SnapshotThread),
    readRows(path.join(directory, "replies.jsonl"), SnapshotReply),
    readRows(path.join(directory, "decisions.jsonl"), Decision),
    readRows(path.join(directory, "reviews.jsonl"), Review),
    readRows(path.join(directory, "drafts.jsonl"), Draft),
    readObjects(
      path.join(directory, "observations"),
      RedditDatasetObservationSchema,
    ),
    readObjects(path.join(directory, "audits"), Audit),
  ]);
  return {
    metadata,
    threads,
    replies,
    decisions,
    reviews,
    drafts,
    observations,
    audits,
  };
}
