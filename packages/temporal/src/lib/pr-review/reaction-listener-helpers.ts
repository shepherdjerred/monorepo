/**
 * Helper functions for the reaction-listener activity. Extracted from
 * `activities/pr-review/ingest-dismissals.ts` to keep that file under
 * the lint max-lines threshold and to make the two passes independently
 * testable.
 *
 * Public API the activity uses:
 *   - PassContext / Counters types
 *   - runThumbsDownPass(ctx, counters)
 *   - runResolvedWithoutFollowupPass(ctx, counters)
 */
import { RequestError } from "octokit";
import { z } from "zod/v4";
import * as Sentry from "@sentry/bun";
import { embedClaim, type EmbedDeps } from "#lib/pr-review/embedding.ts";
import {
  appendEntry,
  dismissalKey,
  encodeEmbedding,
  entryAlreadyPresent,
  readEntries,
  type DismissalReason,
  type RedisSend,
} from "#lib/pr-review/dismissed-store.ts";
import {
  prReviewDedupeRedisErrorTotal,
  prReviewReactionIngestTotal,
  prReviewReactionPollErrorTotal,
} from "#observability/pr-review-metrics.ts";

const COMPONENT = "pr-review-pipeline";
/** 24h minimum age between bot comment and PR close to count as a soft dismissal. */
export const RESOLVED_HEURISTIC_MIN_AGE_MS = 24 * 60 * 60 * 1000;

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
      activity: "ingestDismissals",
      ...fields,
    }),
  );
}

export type IngestOctokit = {
  paginate: {
    iterator: (
      route: unknown,
      params: Record<string, unknown>,
    ) => AsyncIterable<{ data: readonly unknown[] }>;
  };
  rest: {
    issues: {
      listCommentsForRepo: unknown;
      listEventsForRepo: unknown;
    };
    pulls: {
      listReviewCommentsForRepo: unknown;
      get: (params: {
        owner: string;
        repo: string;
        pull_number: number;
      }) => Promise<{ data: unknown }>;
      listCommits: unknown;
    };
    reactions: {
      listForPullRequestReviewComment: unknown;
      listForIssueComment: unknown;
    };
  };
};

const ReviewCommentSchema = z.object({
  id: z.number().int(),
  pull_request_url: z.string().min(1).optional(),
  body: z.string().nullish(),
  path: z.string().nullish(),
  created_at: z.string().min(1),
  user: z
    .object({
      login: z.string().nullish(),
      type: z.string().nullish(),
    })
    .nullish(),
});

const ReactionSchema = z.object({
  content: z.string().min(1),
  created_at: z.string().min(1),
  user: z.object({ login: z.string().nullish() }).nullish(),
});

/**
 * Marker the post-review activity embeds in each comment body so the
 * listener can recover the exact finding triple for hash dedupe and
 * embedding without re-running consensus:
 *
 *   `<!-- pr-review-finding hash=<sha256> kind=<correctness|...> file=<path> claim=<text> -->`
 */
const FINDING_MARKER_RE =
  /<!-- pr-review-finding hash=([a-f0-9]+) kind=(correctness|security|performance|convention|deps) file=(.+?) claim=(.+?) -->/;

export type ExtractedFindingRef = {
  readonly hash: string;
  readonly kind: string;
  readonly file: string;
  readonly normalizedClaim: string;
};

export function extractFindingRef(
  body?: string | null,
): ExtractedFindingRef | null {
  if (typeof body !== "string" || body.length === 0) return null;
  const match = FINDING_MARKER_RE.exec(body);
  if (match === null) return null;
  const [, hash, kind, file, claim] = match;
  if (
    hash === undefined ||
    kind === undefined ||
    file === undefined ||
    claim === undefined
  ) {
    return null;
  }
  return { hash, kind, file, normalizedClaim: claim };
}

export function isBotAuthored(
  user:
    | { login?: string | null | undefined; type?: string | null | undefined }
    | null
    | undefined,
  botLogin: string,
): boolean {
  if (user === null || user === undefined) return false;
  if (user.login === botLogin) return true;
  return user.type === "Bot" && (user.login ?? "").includes(botLogin);
}

export type CommitInfo = {
  readonly sha: string;
  readonly files: readonly string[];
};

export function fileTouchedInRange(
  commits: readonly CommitInfo[],
  sinceSha: string,
  file: string,
): boolean {
  let started = false;
  for (const commit of commits) {
    if (!started) {
      if (commit.sha === sinceSha) started = true;
      continue;
    }
    if (commit.files.includes(file)) return true;
  }
  return false;
}

export type PassContext = {
  readonly owner: string;
  readonly repo: string;
  readonly octokit: IngestOctokit;
  readonly redis: RedisSend;
  readonly embed: EmbedDeps;
  readonly now: Date;
  readonly lowerBound: Date;
  readonly botLogin: string;
  readonly ttlSeconds: number;
  readonly heartbeat: (note: string) => void;
};

export type Counters = {
  thumbsDownIngested: number;
  resolvedIngested: number;
  skipped: number;
  errored: number;
  maxObserved: Date;
};

type IngestEntryArgs = {
  readonly redis: RedisSend;
  readonly embed: EmbedDeps;
  readonly owner: string;
  readonly repo: string;
  readonly ref: ExtractedFindingRef;
  readonly reason: DismissalReason;
  readonly weight: number;
  readonly evidence: {
    readonly commentId: number;
    readonly prNumber: number;
    readonly sha: string;
  };
  readonly ttlSeconds: number;
  readonly now: Date;
};

export async function ingestEntry(
  args: IngestEntryArgs,
): Promise<"ingested" | "skipped-duplicate" | "errored"> {
  const {
    redis,
    embed,
    owner,
    repo,
    ref,
    reason,
    weight,
    evidence,
    ttlSeconds,
    now,
  } = args;
  const key = dismissalKey(owner, repo, ref.file, ref.kind);
  const existing = await readEntries(redis, key);
  if (entryAlreadyPresent(existing, ref.hash)) return "skipped-duplicate";
  const embedding = await embedClaim(ref.normalizedClaim, embed);
  if (embedding === null) {
    prReviewReactionPollErrorTotal.inc({ stage: "embedding" });
    return "errored";
  }
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  try {
    await appendEntry(
      redis,
      key,
      {
        hash: ref.hash,
        embedding: encodeEmbedding(embedding.vector),
        dismissedAt: now.toISOString(),
        expiresAt,
        reason,
        weight,
        evidence,
      },
      ttlSeconds,
    );
    return "ingested";
  } catch {
    prReviewDedupeRedisErrorTotal.inc({ stage: "query" });
    return "errored";
  }
}

function parsePrNumberFromUrl(url: unknown): number | null {
  if (typeof url !== "string") return null;
  const match = /\/pulls\/(\d+)$/.exec(url);
  if (match?.[1] === undefined) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function fetchReactions(
  ctx: PassContext,
  commentId: number,
): Promise<readonly unknown[]> {
  let acc: readonly unknown[] = [];
  const iter = ctx.octokit.paginate.iterator(
    ctx.octokit.rest.reactions.listForPullRequestReviewComment,
    { owner: ctx.owner, repo: ctx.repo, comment_id: commentId, per_page: 100 },
  );
  for await (const page of iter) {
    acc = [...acc, ...page.data];
  }
  return acc;
}

export function reviewCommentsIterator(
  ctx: PassContext,
): AsyncIterable<{ data: readonly unknown[] }> {
  return ctx.octokit.paginate.iterator(
    ctx.octokit.rest.pulls.listReviewCommentsForRepo,
    {
      owner: ctx.owner,
      repo: ctx.repo,
      sort: "created",
      direction: "desc",
      since: ctx.lowerBound.toISOString(),
      per_page: 100,
    },
  );
}

type ReviewCommentRecord = z.infer<typeof ReviewCommentSchema>;

type BotComment = {
  readonly comment: ReviewCommentRecord;
  readonly ref: ExtractedFindingRef;
  readonly prNumber: number;
  readonly createdAt: Date;
};

export function extractBotComment(
  raw: unknown,
  botLogin: string,
): BotComment | null {
  const parsed = ReviewCommentSchema.safeParse(raw);
  if (!parsed.success) return null;
  const comment = parsed.data;
  if (!isBotAuthored(comment.user, botLogin)) return null;
  const ref = extractFindingRef(comment.body);
  if (ref === null) return null;
  const prNumber = parsePrNumberFromUrl(comment.pull_request_url);
  if (prNumber === null) return null;
  return {
    comment,
    ref,
    prNumber,
    createdAt: new Date(comment.created_at),
  };
}

async function processThumbsDownComment(
  ctx: PassContext,
  counters: Counters,
  raw: unknown,
): Promise<void> {
  const botComment = extractBotComment(raw, ctx.botLogin);
  if (botComment === null) return;
  if (botComment.createdAt.getTime() < ctx.lowerBound.getTime()) return;
  if (botComment.createdAt.getTime() > counters.maxObserved.getTime()) {
    counters.maxObserved = botComment.createdAt;
  }

  let reactions: readonly unknown[];
  try {
    reactions = await fetchReactions(ctx, botComment.comment.id);
  } catch (error: unknown) {
    if (!(error instanceof RequestError)) Sentry.captureException(error);
    prReviewReactionPollErrorTotal.inc({ stage: "github" });
    return;
  }

  const hasThumbsDown = reactions.some((r) => {
    const parsed = ReactionSchema.safeParse(r);
    return parsed.success && parsed.data.content === "-1";
  });
  if (!hasThumbsDown) return;

  const outcome = await ingestEntry({
    redis: ctx.redis,
    embed: ctx.embed,
    owner: ctx.owner,
    repo: ctx.repo,
    ref: botComment.ref,
    reason: "thumbs-down",
    weight: 1,
    evidence: {
      commentId: botComment.comment.id,
      prNumber: botComment.prNumber,
      sha: botComment.ref.hash.slice(0, 7),
    },
    ttlSeconds: ctx.ttlSeconds,
    now: ctx.now,
  });
  prReviewReactionIngestTotal.inc({ kind: "thumbs-down", outcome });
  if (outcome === "ingested") counters.thumbsDownIngested += 1;
  else if (outcome === "skipped-duplicate") counters.skipped += 1;
  else counters.errored += 1;
}

export async function runThumbsDownPass(
  ctx: PassContext,
  counters: Counters,
): Promise<void> {
  try {
    for await (const page of reviewCommentsIterator(ctx)) {
      ctx.heartbeat("listReviewCommentsForRepo");
      for (const raw of page.data) {
        await processThumbsDownComment(ctx, counters, raw);
      }
    }
  } catch (error: unknown) {
    Sentry.captureException(error);
    prReviewReactionPollErrorTotal.inc({ stage: "github" });
    jsonLog("error", "thumbs-down pass failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// runResolvedWithoutFollowupPass lives in reaction-listener-resolved.ts
// to keep both modules under the lint max-lines threshold.
