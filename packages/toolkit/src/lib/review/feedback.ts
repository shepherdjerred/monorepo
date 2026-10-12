import { z } from "zod";
import {
  isProviderAuthor,
  PROVIDERS,
  resolveProvider,
  type ReviewProvider,
} from "@shepherdjerred/code-review";
import { listFindings, type Finding } from "./findings.ts";
import { GitHubClient, type CiReview } from "#lib/ci/github.ts";
import {
  CommentSchema,
  threadsFor,
  threadFeedback,
  reviewFeedback,
  providerFor,
  type ReviewFeedback,
} from "./feedback-sources.ts";

type FeedbackInput = {
  repo: string;
  number: number;
  token: string;
  provider?: string | undefined;
  all?: boolean | undefined;
};

async function readSources(input: FeedbackInput) {
  const github = new GitHubClient(input.token, input.repo);
  const [pr, threads, reviews, comments] = await Promise.all([
    github.pr(input.number),
    threadsFor(github, input.number),
    github.reviews(input.number),
    github.pages(
      `/repos/${input.repo}/issues/${String(input.number)}/comments`,
      z.array(CommentSchema),
    ),
  ]);
  return {
    input,
    pr,
    threads,
    reviews,
    comments,
    byThread: new Map(
      threads.map((thread) => [thread.id, threadFeedback(thread, input.repo)]),
    ),
    byComment: new Map(comments.map((comment) => [comment.id, comment])),
  };
}
type Sources = Awaited<ReturnType<typeof readSources>>;

function isAutomationComment(body: string): boolean {
  return (
    body.includes("<!-- gs:navigation comment -->") ||
    body.includes("<!-- review-request:")
  );
}

function isHumanComment(comment: z.infer<typeof CommentSchema>): boolean {
  return (
    comment.user?.type !== "Bot" &&
    providerFor(comment.user?.login ?? null) === null &&
    !isAutomationComment(comment.body)
  );
}

function presentProviders(sources: Sources): ReviewProvider[] {
  if (sources.input.provider !== undefined)
    return [resolveProvider(sources.input.provider)];
  const authors = [
    ...sources.threads.map(
      (thread) => thread.comments.nodes[0]?.author?.login ?? null,
    ),
    ...sources.reviews.map((review) => review.user?.login ?? null),
    ...sources.comments.map((comment) => comment.user?.login ?? null),
  ];
  return Object.values(PROVIDERS).filter((provider) =>
    authors.some((author) => isProviderAuthor(provider, author)),
  );
}

/** Non-addressable findings in review bodies retain their original review source. */
function bodySource(
  provider: ReviewProvider,
  finding: Finding,
  reviews: readonly CiReview[],
): CiReview | undefined {
  if (provider.parseReviewBodyFindings === null) return undefined;
  const snapshots = reviews
    .filter((review) => isProviderAuthor(provider, review.user?.login ?? null))
    .map((review) => ({
      id: review.node_id,
      body: review.body,
      submittedAt: review.submitted_at,
      commitOid: review.commit_id,
    }));
  const matches = provider
    .parseReviewBodyFindings(snapshots)
    .filter(
      (item) =>
        item.thread.title === finding.title &&
        item.thread.path === finding.path,
    );
  const match = matches.toSorted((a, b) =>
    (b.reviewSubmittedAt ?? "").localeCompare(a.reviewSubmittedAt ?? ""),
  )[0];
  return match === undefined
    ? undefined
    : reviews.find((review) => review.node_id === match.reviewId);
}

function providerFeedback(
  provider: ReviewProvider,
  finding: Finding,
  sources: Sources,
): ReviewFeedback {
  const thread =
    finding.threadId === null
      ? undefined
      : sources.byThread.get(finding.threadId);
  const comment =
    finding.commentId === null
      ? undefined
      : sources.byComment.get(finding.commentId);
  const review =
    thread === undefined && comment === undefined
      ? bodySource(provider, finding, sources.reviews)
      : undefined;
  if (thread !== undefined)
    return {
      ...finding,
      author: thread.author,
      provider: provider.id,
      contents: thread.contents,
      rawCommand: thread.rawCommand,
    };
  if (comment !== undefined)
    return {
      ...finding,
      author: comment.user?.login ?? null,
      provider: provider.id,
      contents: comment.body,
      rawCommand: `toolkit gh api repos/${sources.input.repo}/issues/comments/${String(comment.id)}`,
    };
  if (review !== undefined)
    return {
      ...finding,
      author: review.user?.login ?? null,
      provider: provider.id,
      contents: review.body ?? "",
      rawCommand: `toolkit gh api repos/${sources.input.repo}/pulls/reviews/${String(review.id)}`,
    };
  throw new Error("Provider finding has no readable GitHub surface");
}

function additionalFeedback(
  sources: Sources,
  represented: readonly ReviewFeedback[],
): ReviewFeedback[] {
  const feedback: ReviewFeedback[] = [];
  const representedThreads = new Set(represented.map((item) => item.threadId));
  const representedComments = new Set(
    represented.map((item) => item.commentId),
  );
  for (const [id, thread] of sources.byThread)
    if (!representedThreads.has(id)) feedback.push(thread);
  for (const review of sources.reviews) {
    if (
      (review.body ?? "").trim() !== "" &&
      (providerFor(review.user?.login ?? null) !== null ||
        review.user?.type !== "Bot")
    ) {
      feedback.push(
        reviewFeedback(review, sources.pr.head.sha, sources.input.repo),
      );
    }
  }
  for (const comment of sources.comments) {
    if (representedComments.has(comment.id) || !isHumanComment(comment))
      continue;
    feedback.push({
      key: `comment:${String(comment.id)}`,
      author: comment.user?.login ?? null,
      provider: null,
      priority: null,
      title: null,
      contents: comment.body,
      path: null,
      line: null,
      isResolved: false,
      isOutdated: false,
      threadId: null,
      commentId: comment.id,
      url: comment.html_url,
      rawCommand: `toolkit gh api repos/${sources.input.repo}/issues/comments/${String(comment.id)}`,
    });
  }
  return feedback;
}

export async function listReviewFeedback(input: FeedbackInput) {
  const sources = await readSources(input);
  const normalized = await Promise.all(
    presentProviders(sources).map(async (provider) => ({
      provider,
      result: await listFindings({
        ...input,
        head: sources.pr.head.sha,
        provider,
        includeOutdated: input.all,
      }),
    })),
  );
  const feedback = normalized.flatMap(({ provider, result }) =>
    result.findings.map((finding) =>
      providerFeedback(provider, finding, sources),
    ),
  );
  feedback.push(...additionalFeedback(sources, feedback));
  const selected =
    input.provider === undefined ? null : resolveProvider(input.provider).id;
  return {
    repo: input.repo,
    pr: input.number,
    head: sources.pr.head.sha,
    findings: feedback.filter(
      (item) =>
        (input.all === true || (!item.isResolved && !item.isOutdated)) &&
        (selected === null || item.provider === selected),
    ),
    providers: normalized.map(({ provider, result }) => ({
      id: provider.id,
      reviewedCommit: result.reviewState.reviewedCommit,
      blockedReason: result.reviewState.blockedReason,
    })),
  };
}
