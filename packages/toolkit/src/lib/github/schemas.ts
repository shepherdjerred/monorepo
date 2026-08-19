import { z } from "zod";

// `gh pr view --json reviewDecision` returns "" (empty string) — not null —
// when a PR has no review decision yet. Accept empty string and normalize it
// to null so downstream comparisons (e.g. `=== "APPROVED"`) stay simple.
const ReviewDecisionSchema = z
  .union([
    z.enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"]),
    z.literal(""),
    z.null(),
  ])
  .transform((value) => (value === "" ? null : value));

export const PullRequestSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  headRefName: z.string(),
  headRefOid: z.string(),
  baseRefName: z.string(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  isDraft: z.boolean(),
  mergeable: z.enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"]),
  reviewDecision: ReviewDecisionSchema,
});

export const GitHubCheckSchema = z.object({
  name: z.string(),
  state: z.string(),
  bucket: z.string(),
  link: z.union([z.url(), z.literal("")]).optional(),
});

export const ReviewSchema = z.object({
  author: z.object({
    login: z.string(),
  }),
  state: z.enum([
    "APPROVED",
    "CHANGES_REQUESTED",
    "COMMENTED",
    "PENDING",
    "DISMISSED",
  ]),
  submittedAt: z.string(),
});

export const ReviewsResponseSchema = z.object({
  reviews: z.array(ReviewSchema),
});
