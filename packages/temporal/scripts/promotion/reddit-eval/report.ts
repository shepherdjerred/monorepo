import { promotionSpendDay } from "#activities/promotion/control/budget.ts";
import {
  REDDIT_DECISION_POLICY,
  qualifyRedditAnswers,
} from "#activities/promotion/reddit-discovery/decisions.ts";
import { guardRedditInviteDraft } from "#activities/promotion/reddit-discovery/relevance.ts";
import type { ReplayInputs, ReplayReview } from "./inputs.ts";

const POLICIES = {
  production: REDDIT_DECISION_POLICY,
  "fit-0.50": { ...REDDIT_DECISION_POLICY, fitThreshold: 0.5 },
  "fit-0.40": { ...REDDIT_DECISION_POLICY, fitThreshold: 0.4 },
  "intent-0.70": { ...REDDIT_DECISION_POLICY, seekerConfidence: 0.7 },
  "requirements-0.60": {
    ...REDDIT_DECISION_POLICY,
    hardConstraintConfidence: 0.6,
  },
};

function countBy(values: Iterable<string>) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries(counts);
}

function archivedLabel(value: string): ReplayReview["label"] {
  switch (value) {
    case "clear_missed_match":
    case "clear_match_published":
      return "eligible";
    case "recruiter_false_positive":
    case "incompatible_requirement":
    case "subreddit_gate":
      return "ineligible";
    case "duplicate_request":
      return "duplicate";
    case "conditional_partial_fit":
    case "adjacent_intent":
      return "uncertain";
    default:
      throw new Error(`Unknown archived review label ${value}`);
  }
}

type Decision = ReplayInputs["decisions"][number];
type Candidate = Decision & { postId: string };
type Policy = Readonly<typeof REDDIT_DECISION_POLICY>;
type Outcome = ReturnType<typeof qualifyRedditAnswers>;

function gateFailures(outcome: Outcome, policy: Policy) {
  return [
    !outcome.explicitlySeekingServer && "intent",
    !outcome.communityAllowsReply && "rules",
    !outcome.hardConstraintsSatisfied && "requirements",
    outcome.judgeScore < policy.fitThreshold && "fit",
  ].filter((failure) => failure !== false);
}

function comparePolicy(
  policy: Policy,
  candidates: Iterable<Candidate>,
  reviews: ReadonlyMap<string, ReplayReview>,
  subreddits: ReadonlyMap<string, string>,
) {
  const outcomes = [...candidates].map(({ postId, answers }) => ({
    postId,
    outcome: qualifyRedditAnswers(answers, policy),
  }));
  const qualified = outcomes
    .filter(({ outcome }) => outcome.decision === "match")
    .map(({ postId }) => postId);
  const opportunities = new Map<string, string>();
  const labeledMatches = new Set<string>();
  for (const postId of qualified) {
    const review = reviews.get(postId);
    if (review?.label === "ineligible" || review?.label === "duplicate")
      continue;
    const identity = review?.requestId ?? postId;
    const subreddit = subreddits.get(postId) ?? "unjoined";
    if (!opportunities.has(identity)) opportunities.set(identity, subreddit);
    if (review?.label === "eligible") labeledMatches.add(identity);
  }
  const missedEligible = new Map<string, string>();
  for (const review of reviews.values()) {
    const identity = review.requestId ?? review.postId;
    if (
      review.label === "eligible" &&
      !labeledMatches.has(identity) &&
      !missedEligible.has(identity)
    )
      missedEligible.set(identity, review.postId);
  }
  return {
    policy,
    qualified: qualified.length,
    distinctOpportunities: opportunities.size,
    opportunitiesBySubreddit: countBy(opportunities.values()),
    labeledEligibleMatches: labeledMatches.size,
    falsePositives: qualified.filter(
      (postId) => reviews.get(postId)?.label === "ineligible",
    ),
    missedEligible: [...missedEligible.values()],
    overlappingGateFailures: countBy(
      outcomes.flatMap(({ outcome }) => gateFailures(outcome, policy)),
    ),
    qualifiedPostIds: qualified,
  };
}

function collectObservations(
  input: ReplayInputs,
  matchingDate: (instant: string) => boolean,
  subreddits: Map<string, string>,
) {
  const observed = new Set<string>();
  let listingRows = 0;
  let threadReads = 0;
  let loadedComments = 0;
  const decisions = input.decisions.filter(({ observedAt, capturedAt }) =>
    matchingDate(observedAt ?? capturedAt),
  );
  let missingAnswers = 0;
  for (const observation of input.observations) {
    if (!matchingDate(observation.observedAt)) continue;
    if (observation.kind === "listing") {
      listingRows += observation.posts.length;
      for (const post of observation.posts) {
        observed.add(post.id);
        subreddits.set(post.id, post.subreddit);
      }
    } else if (observation.kind === "thread") {
      threadReads++;
      loadedComments += observation.comments.length;
      subreddits.set(observation.post.id, observation.post.subreddit);
    } else if (observation.answers === null) {
      missingAnswers++;
    } else {
      decisions.push({
        postId: observation.postId,
        occurrenceId: observation.occurrenceId,
        capturedAt: observation.capturedAt,
        observedAt: observation.observedAt,
        model: observation.model,
        answers: observation.answers,
      });
    }
  }
  return {
    observed,
    listingRows,
    threadReads,
    loadedComments,
    decisions,
    missingAnswers,
  };
}

function verifiedReceipts(
  replies: ReplayInputs["replies"],
  audits: ReplayInputs["audits"],
) {
  return new Set([
    ...replies.flatMap((reply) =>
      reply.relation === "the_storm" && reply.status === "verified"
        ? [reply.sourceUrl]
        : [],
    ),
    ...audits.flatMap(({ replies: auditReplies }) =>
      auditReplies.flatMap((reply) =>
        reply.status === "verified" && reply.receiptUrl !== undefined
          ? [reply.receiptUrl]
          : [],
      ),
    ),
  ]);
}

function collectOutcomes(
  input: ReplayInputs,
  matchingDate: (instant: string) => boolean,
  subreddits: Map<string, string>,
) {
  const reviews = new Map<string, ReplayReview>();
  const outcomeByPost = new Map<string, string>();
  const outcomeByRunAndPost = new Map<string, Map<string, string>>();
  for (const thread of input.threads) {
    subreddits.set(thread.postId, thread.subreddit);
    outcomeByPost.set(thread.postId, thread.result);
    if (thread.review !== undefined) {
      reviews.set(thread.postId, {
        postId: thread.postId,
        label: archivedLabel(thread.review.label),
      });
    }
  }
  for (const review of input.reviews) reviews.set(review.postId, review);
  const audits = input.audits
    .filter(({ completedAt, preview }) => !preview && matchingDate(completedAt))
    .sort((left, right) => left.completedAt.localeCompare(right.completedAt));
  for (const audit of audits) {
    const outcomes = new Map<string, string>();
    for (const post of audit.posts ?? []) {
      outcomeByPost.set(post.id, post.result);
      outcomes.set(post.id, post.result);
      subreddits.set(post.id, post.subreddit);
    }
    outcomeByRunAndPost.set(audit.occurrenceId, outcomes);
  }
  return { reviews, outcomeByPost, outcomeByRunAndPost, audits };
}

function latestCandidates(decisions: readonly Decision[]) {
  const candidates = new Map<string, Candidate>();
  for (const decision of decisions) {
    const { postId, capturedAt, observedAt = capturedAt } = decision;
    if (postId === null) continue;
    const previous = candidates.get(postId);
    if (
      previous === undefined ||
      Date.parse(previous.observedAt ?? previous.capturedAt) <=
        Date.parse(observedAt)
    )
      candidates.set(postId, { ...decision, postId });
  }
  return candidates;
}

export function replayRedditOutreach(input: ReplayInputs, day: string) {
  const subreddits = new Map<string, string>();
  const matchingDate = (at: string) => promotionSpendDay(new Date(at)) === day;
  const {
    observed,
    listingRows,
    threadReads,
    loadedComments,
    decisions,
    missingAnswers,
  } = collectObservations(input, matchingDate, subreddits);
  const { reviews, outcomeByPost, outcomeByRunAndPost, audits } =
    collectOutcomes(input, matchingDate, subreddits);
  const candidates = latestCandidates(decisions);
  return {
    day,
    comparison:
      "Current production policy and single-gate variants applied to archived answers",
    stages: {
      listingRows,
      distinctListedPosts: observed.size,
      threadReads,
      loadedComments,
      archivedDecisions: decisions.length,
      decisionModels: countBy(decisions.map(({ model }) => model)),
      decisionsWithoutPostId: decisions.filter(({ postId }) => postId === null)
        .length,
      decisionObservationsWithoutAnswers: missingAnswers,
      postsWithDecisionAnswers: candidates.size,
      auditedPosts: outcomeByPost.size,
      listedPostsJoinedToAnAudit: [...observed].filter((postId) =>
        outcomeByPost.has(postId),
      ).length,
      auditOutcomes: countBy(outcomeByPost.values()),
      incompleteSubredditWindows: audits
        .flatMap(({ coverage = [] }) => coverage)
        .filter(({ complete }) => !complete).length,
      verifiedReplies: verifiedReceipts(input.replies, audits).size,
    },
    reviews: countBy([...reviews.values()].map(({ label }) => label)),
    policies: Object.fromEntries(
      Object.entries(POLICIES).map(([name, policy]) => [
        name,
        comparePolicy(policy, candidates.values(), reviews, subreddits),
      ]),
    ),
    decisions: [...candidates.values()].map(
      ({
        postId,
        occurrenceId,
        capturedAt,
        observedAt = capturedAt,
        answers,
      }) => ({
        postId,
        occurrenceId: occurrenceId ?? null,
        capturedAt,
        observedAt,
        subreddit: subreddits.get(postId) ?? null,
        review: reviews.get(postId)?.label ?? null,
        observedOutcome:
          (occurrenceId === undefined
            ? outcomeByPost.get(postId)
            : outcomeByRunAndPost.get(occurrenceId)?.get(postId)) ?? null,
        productionScore: qualifyRedditAnswers(answers).judgeScore,
      }),
    ),
    draftReplay: input.drafts.map(({ postId, draft, ...context }) => {
      const guarded = guardRedditInviteDraft(draft, {
        ...context,
        signal: new AbortController().signal,
      });
      return {
        postId,
        accepted: guarded.reply !== null,
        reason: guarded.reason,
      };
    }),
  };
}
