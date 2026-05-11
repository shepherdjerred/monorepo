/**
 * Pass 2 of the reaction-listener: resolved-without-followup-24h heuristic.
 *
 * A bot comment counts as "softly dismissed" (weight 0.5) when:
 *   - the PR was closed or merged ≥24h after the comment, AND
 *   - no commit on the PR (between comment timestamp and HEAD) touches
 *     the file the bot flagged.
 *
 * Split from `reaction-listener-helpers.ts` to keep both modules under
 * the lint max-lines threshold.
 */
import { RequestError } from "octokit";
import { z } from "zod/v4";
import * as Sentry from "@sentry/bun";
import {
  prReviewReactionIngestTotal,
  prReviewReactionPollErrorTotal,
} from "#observability/pr-review-metrics.ts";
import {
  RESOLVED_HEURISTIC_MIN_AGE_MS,
  extractBotComment,
  ingestEntry,
  reviewCommentsIterator,
  type CommitInfo,
  type Counters,
  type ExtractedFindingRef,
  type PassContext,
} from "#lib/pr-review/reaction-listener-helpers.ts";

const PullsGetSchema = z.object({
  number: z.number().int().positive(),
  state: z.string().min(1),
  merged: z.boolean().optional(),
  merged_at: z.string().nullish(),
  closed_at: z.string().nullish(),
  head: z.object({ sha: z.string().min(1) }).nullish(),
});

const CommitSchema = z.object({
  sha: z.string().min(1),
  files: z.array(z.object({ filename: z.string().min(1) })).nullish(),
});

type CandidateComment = {
  readonly commentId: number;
  readonly createdAt: Date;
  readonly ref: ExtractedFindingRef;
};

async function collectCandidatesByPr(
  ctx: PassContext,
): Promise<Map<number, CandidateComment[]>> {
  const byPr = new Map<number, CandidateComment[]>();
  try {
    for await (const page of reviewCommentsIterator(ctx)) {
      for (const raw of page.data) {
        const botComment = extractBotComment(raw, ctx.botLogin);
        if (botComment === null) continue;
        const list = byPr.get(botComment.prNumber) ?? [];
        list.push({
          commentId: botComment.comment.id,
          createdAt: botComment.createdAt,
          ref: botComment.ref,
        });
        byPr.set(botComment.prNumber, list);
      }
    }
  } catch (error: unknown) {
    Sentry.captureException(error);
    prReviewReactionPollErrorTotal.inc({ stage: "github" });
  }
  return byPr;
}

async function getPullRequest(
  ctx: PassContext,
  prNumber: number,
): Promise<z.infer<typeof PullsGetSchema> | null> {
  try {
    const resp = await ctx.octokit.rest.pulls.get({
      owner: ctx.owner,
      repo: ctx.repo,
      pull_number: prNumber,
    });
    const parsed = PullsGetSchema.safeParse(resp.data);
    return parsed.success ? parsed.data : null;
  } catch (error: unknown) {
    if (!(error instanceof RequestError) || error.status !== 404) {
      Sentry.captureException(error);
      prReviewReactionPollErrorTotal.inc({ stage: "github" });
    }
    return null;
  }
}

async function listPrCommits(
  ctx: PassContext,
  prNumber: number,
): Promise<CommitInfo[]> {
  const commits: CommitInfo[] = [];
  try {
    const iter = ctx.octokit.paginate.iterator(
      ctx.octokit.rest.pulls.listCommits,
      {
        owner: ctx.owner,
        repo: ctx.repo,
        pull_number: prNumber,
        per_page: 100,
      },
    );
    for await (const page of iter) {
      for (const raw of page.data) {
        const parsed = CommitSchema.safeParse(raw);
        if (!parsed.success) continue;
        commits.push({
          sha: parsed.data.sha,
          files: (parsed.data.files ?? []).map((f) => f.filename),
        });
      }
    }
  } catch (error: unknown) {
    Sentry.captureException(error);
    prReviewReactionPollErrorTotal.inc({ stage: "github" });
  }
  return commits;
}

type ResolvedCandidateArgs = {
  readonly ctx: PassContext;
  readonly counters: Counters;
  readonly prNumber: number;
  readonly closedAtDate: Date;
  readonly prHeadSha: string;
  readonly commits: readonly CommitInfo[];
  readonly candidate: CandidateComment;
};

async function processResolvedCandidate(
  args: ResolvedCandidateArgs,
): Promise<void> {
  const {
    ctx,
    counters,
    prNumber,
    closedAtDate,
    prHeadSha,
    commits,
    candidate,
  } = args;
  const ageAtCloseMs = closedAtDate.getTime() - candidate.createdAt.getTime();
  if (ageAtCloseMs < RESOLVED_HEURISTIC_MIN_AGE_MS) return;
  const touched = commits.some((c) => c.files.includes(candidate.ref.file));
  if (touched) return;

  const outcome = await ingestEntry({
    redis: ctx.redis,
    embed: ctx.embed,
    owner: ctx.owner,
    repo: ctx.repo,
    ref: candidate.ref,
    reason: "resolved-without-followup",
    weight: 0.5,
    evidence: {
      commentId: candidate.commentId,
      prNumber,
      sha: prHeadSha,
    },
    ttlSeconds: ctx.ttlSeconds,
    now: ctx.now,
  });
  prReviewReactionIngestTotal.inc({
    kind: "resolved-without-followup",
    outcome,
  });
  if (outcome === "ingested") counters.resolvedIngested += 1;
  else if (outcome === "skipped-duplicate") counters.skipped += 1;
  else counters.errored += 1;
  if (candidate.createdAt.getTime() > counters.maxObserved.getTime()) {
    counters.maxObserved = candidate.createdAt;
  }
}

export async function runResolvedWithoutFollowupPass(
  ctx: PassContext,
  counters: Counters,
): Promise<void> {
  const candidatesByPr = await collectCandidatesByPr(ctx);
  for (const [prNumber, candidates] of candidatesByPr) {
    const pr = await getPullRequest(ctx, prNumber);
    if (pr === null) continue;
    if (pr.state === "open") continue;
    const closedAt = pr.merged_at ?? pr.closed_at;
    if (typeof closedAt !== "string") continue;
    const closedAtDate = new Date(closedAt);
    const commits = await listPrCommits(ctx, prNumber);
    const prHeadSha = pr.head?.sha ?? "";
    for (const candidate of candidates) {
      await processResolvedCandidate({
        ctx,
        counters,
        prNumber,
        closedAtDate,
        prHeadSha,
        commits,
        candidate,
      });
    }
  }
}
