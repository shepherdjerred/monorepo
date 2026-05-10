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
  baseRefName: z.string(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  isDraft: z.boolean(),
  mergeable: z.enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"]),
  reviewDecision: ReviewDecisionSchema,
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

export const CheckRunSchema = z.object({
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  detailsUrl: z.string(),
  workflowName: z.string(),
});

export const WorkflowRunSchema = z.object({
  databaseId: z.number(),
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  url: z.string(),
  createdAt: z.string(),
});

export const ReviewsResponseSchema = z.object({
  reviews: z.array(ReviewSchema),
});

export const HeadRefResponseSchema = z.object({
  headRefName: z.string(),
});
