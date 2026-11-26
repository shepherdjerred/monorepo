import { describe, expect, it } from "vitest";
import { REDDIT_DECISIONS_MODEL } from "#activities/promotion/reddit-discovery/decisions.ts";
import type { ReplayInputs } from "./inputs.ts";
import { replayRedditOutreach } from "./report.ts";

const day = "2026-11-25";
const capturedAt = "2026-11-26T03:00:00Z";

function decision(postId: string, fit: number, restricted = false) {
  const selectedRule = restricted ? "restricted" : "no_identified_restriction";
  return {
    postId,
    capturedAt,
    model: REDDIT_DECISIONS_MODEL,
    answers: [
      { type: "predicate", name: "strong_main_match", probability: fit },
      { type: "predicate", name: "explicit_server_seeker", probability: 0.9 },
      {
        type: "choice",
        name: "community_reply_restriction",
        choice: selectedRule,
        confidence: 1,
        probabilities: [
          { value: "restricted", probability: restricted ? 1 : 0 },
          {
            value: "no_identified_restriction",
            probability: restricted ? 0 : 1,
          },
        ],
      },
      {
        type: "choice",
        name: "post_intent",
        choice: "find_server",
        confidence: 1,
        probabilities: [
          { value: "find_server", probability: 1 },
          { value: "advertise_server", probability: 0 },
          { value: "hosting_or_support", probability: 0 },
          { value: "other_or_unclear", probability: 0 },
        ],
      },
      {
        type: "choice",
        name: "hard_constraints",
        choice: "satisfied",
        confidence: 1,
        probabilities: [
          { value: "satisfied", probability: 1 },
          { value: "unmet", probability: 0 },
          { value: "unknown", probability: 0 },
        ],
      },
    ],
  } satisfies ReplayInputs["decisions"][number];
}

function emptyInput() {
  return {
    metadata: undefined,
    threads: [],
    replies: [],
    drafts: [],
    observations: [],
    audits: [],
    decisions: [],
    reviews: [],
  } satisfies ReplayInputs;
}

describe("Reddit outreach replay", () => {
  it("compares gates without counting a veto, cross-post, or other Pacific day as supply", () => {
    const report = replayRedditOutreach(
      {
        ...emptyInput(),
        decisions: [
          decision("first", 0.9),
          decision("crosspost", 0.9),
          decision("borderline", 0.54),
          decision("recruiting", 0.42),
          decision("restricted", 0.99, true),
          { ...decision("tomorrow", 0.99), capturedAt: "2026-11-26T08:00:00Z" },
        ],
        reviews: [
          { postId: "first", label: "eligible", requestId: "original" },
          { postId: "crosspost", label: "eligible", requestId: "original" },
          { postId: "borderline", label: "eligible" },
          { postId: "recruiting", label: "ineligible" },
          { postId: "restricted", label: "ineligible" },
        ],
      },
      day,
    );
    expect(report.stages.postsWithDecisionAnswers).toBe(5);
    expect(report.policies["production"]).toMatchObject({
      distinctOpportunities: 1,
      labeledEligibleMatches: 1,
      missedEligible: ["borderline"],
    });
    expect(report.policies["fit-0.50"]).toMatchObject({
      distinctOpportunities: 2,
      labeledEligibleMatches: 2,
    });
    expect(report.policies["fit-0.40"]).toMatchObject({
      distinctOpportunities: 2,
      falsePositives: ["recruiting"],
      qualifiedPostIds: ["first", "crosspost", "borderline", "recruiting"],
    });
  });

  it("joins an older cached decision to the sweep that observed it", () => {
    const post = {
      id: "seeker",
      title: "Looking for a small Java SMP",
      subreddit: "MinecraftServer",
      url: "https://www.reddit.com/r/MinecraftServer/comments/seeker/",
    };
    const auditPost = {
      ...post,
      score: 0.9,
      result: "draft-rejected" as const,
      reason: "draft-rejected",
    };
    const report = replayRedditOutreach(
      {
        ...emptyInput(),
        observations: [
          {
            schemaVersion: 1,
            kind: "decision",
            occurrenceId: "first-run",
            observedAt: capturedAt,
            capturedAt: "2026-11-25T03:00:00Z",
            postId: post.id,
            model: REDDIT_DECISIONS_MODEL,
            communityRules: "On-topic responses are allowed.",
            approvedServerFacts: "The Storm is a small Minecraft community.",
            answers: decision(post.id, 0.9).answers,
          },
        ],
        audits: [
          {
            occurrenceId: "first-run",
            completedAt: capturedAt,
            preview: false,
            posts: [auditPost],
            replies: [],
          },
          {
            occurrenceId: "second-run",
            completedAt: "2026-11-26T04:00:00Z",
            preview: false,
            posts: [{ ...auditPost, result: "publish-verified" }],
            replies: [],
          },
        ],
      },
      day,
    );
    expect(report.decisions).toEqual([
      {
        postId: "seeker",
        occurrenceId: "first-run",
        capturedAt: "2026-11-25T03:00:00Z",
        observedAt: capturedAt,
        subreddit: "MinecraftServer",
        review: null,
        observedOutcome: "draft-rejected",
        productionScore: 0.9,
      },
    ]);
    expect(report.stages.auditOutcomes).toEqual({ "publish-verified": 1 });
  });
});
