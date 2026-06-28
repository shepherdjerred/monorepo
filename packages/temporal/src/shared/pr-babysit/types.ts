/**
 * Pure types + schemas for the PR babysitter (the bot that drives an open PR
 * to "ready to merge": CI green, no merge conflicts vs the base branch, no
 * unresolved P3-or-higher review comments).
 *
 * This module is import-clean — zod only, no Sentry / observability / activity
 * imports — so it is safe to pull into the (future) Temporal workflow bundle.
 * See packages/temporal/CLAUDE.md (`bundle.test.ts` rule).
 */
import { z } from "zod/v4";

/**
 * Buildkite step contexts (surfaced to GitHub as commit statuses like
 * `buildkite/monorepo/pr/scissors-knip`) that are SOFT failures the babysitter
 * ignores when deciding "is CI green". A context is soft when ANY of these
 * substrings appears in its name. Mirrors the manual babysitter spec.
 */
export const SOFT_FAILURE_CONTEXT_SUBSTRINGS: readonly string[] = [
  "scissors-knip",
  "knip",
  "shield-trivy-scan",
  "trivy",
  "semgrep",
];

/** Review-comment severities, most-severe first. */
export const REVIEW_SEVERITIES = ["P0", "P1", "P2", "P3"] as const;
export const ReviewSeveritySchema = z.enum(REVIEW_SEVERITIES);
export type ReviewSeverity = z.infer<typeof ReviewSeveritySchema>;

/**
 * Default blocking threshold: a thread blocks the DoD when its severity is
 * "P3 or higher" (P3, P2, P1, P0). Lower index = more severe.
 */
export const DEFAULT_BLOCKING_SEVERITY: ReviewSeverity = "P3";

export const PrBabysitBudgetSchema = z.object({
  /** Hard cap on fix→commit→push iterations before standing down. */
  maxIterations: z.number().int().positive().default(12),
  /** Hard wall-clock ceiling for the whole babysit run. */
  maxWallClockMinutes: z.number().int().positive().default(360),
  /** Stop once cumulative agent cost crosses this (USD). */
  maxCostUsd: z.number().positive().default(20),
  /**
   * Per-iteration agent turn cap (claude `--max-turns`). A multi-fix iteration
   * (edit several files + run validation + commit + resolve threads) needs well
   * over the agent-task default; 40 was observed to exhaust mid-iteration and
   * lose uncommitted work, so the agent is also told to commit incrementally.
   */
  perIterationMaxTurns: z.number().int().positive().default(100),
  /** Per-iteration agent wall-clock cap (minutes). Bounds a single claude run. */
  perIterationTimeoutMinutes: z.number().int().positive().max(90).default(30),
  /**
   * Stand down after this many consecutive iterations that produce the same
   * failure signature (no measurable progress) — the infinite-fix guard.
   */
  stuckThreshold: z.number().int().positive().default(3),
});
export type PrBabysitBudget = z.infer<typeof PrBabysitBudgetSchema>;

/** All-defaults budget; used as the default for the input's `budget` field. */
export const DEFAULT_PR_BABYSIT_BUDGET: PrBabysitBudget =
  PrBabysitBudgetSchema.parse({});

export const PrBabysitInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  prNumber: z.number().int().positive(),
  /** PR head branch ref (the branch we push fixes to), e.g. `feature/x`. */
  headRef: z.string().min(1),
  /** Base branch to check conflicts against. */
  baseRef: z.string().min(1).default("main"),
  /** Free-text goal / steering from the triggering comment, if any. */
  goal: z.string().min(1).optional(),
  /** Model for the mutating agent. */
  model: z.string().min(1).default("claude-opus-4-8"),
  /** Severity at/above which an unresolved review thread blocks the DoD. */
  blockingSeverity: ReviewSeveritySchema.default(DEFAULT_BLOCKING_SEVERITY),
  budget: PrBabysitBudgetSchema.default(DEFAULT_PR_BABYSIT_BUDGET),
});
export type PrBabysitInput = z.infer<typeof PrBabysitInputSchema>;

export const PrStateSchema = z.enum(["open", "closed", "merged"]);
export type PrState = z.infer<typeof PrStateSchema>;

export const CiVerdictSchema = z.object({
  green: z.boolean(),
  /** Non-soft contexts whose conclusion is a failure. */
  failing: z.array(z.string()),
  /** Non-soft contexts still running / queued. */
  pending: z.array(z.string()),
  /** Soft contexts that failed but are ignored by policy. */
  ignoredSoft: z.array(z.string()),
  /**
   * True when GitHub reported NO check rows at all. Right after a push the
   * status/check contexts have not registered yet — an empty set means "CI has
   * not started", NOT "everything passed", so such a verdict is never `green`.
   */
  noChecksReported: z.boolean(),
  /**
   * Required status-check contexts (per the repo's branch ruleset) that are not
   * yet present-and-passing. Guards "partial checks pass early": a fast check
   * passing before the slow required build-completion check registers must NOT
   * read as green. A non-empty list keeps `green` false.
   */
  missingRequired: z.array(z.string()),
});
export type CiVerdict = z.infer<typeof CiVerdictSchema>;

export const ConflictVerdictSchema = z.object({
  clean: z.boolean(),
  paths: z.array(z.string()),
  baseRef: z.string(),
});
export type ConflictVerdict = z.infer<typeof ConflictVerdictSchema>;

export const UnresolvedThreadSchema = z.object({
  threadId: z.string(),
  /** Severity if one was parseable from the comment body. */
  severity: ReviewSeveritySchema.optional(),
  author: z.string(),
  isGreptile: z.boolean(),
  /** First line / snippet of the thread's first comment, for the report. */
  snippet: z.string(),
  url: z.string().optional(),
});
export type UnresolvedThread = z.infer<typeof UnresolvedThreadSchema>;

export const ReviewVerdictSchema = z.object({
  /** No unresolved thread at/above the blocking severity. */
  allResolved: z.boolean(),
  /** Unresolved threads that block (severity ≥ threshold). */
  blocking: z.array(UnresolvedThreadSchema),
  /** Unresolved threads below the threshold / without severity — reported, not blocking. */
  advisory: z.array(UnresolvedThreadSchema),
});
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;

export const BabysitVerdictSchema = z.object({
  headSha: z.string(),
  prState: PrStateSchema,
  ci: CiVerdictSchema,
  conflicts: ConflictVerdictSchema,
  reviews: ReviewVerdictSchema,
  /** ci.green && conflicts.clean && reviews.allResolved && prState === "open". */
  dodMet: z.boolean(),
  evaluatedAt: z.string(),
});
export type BabysitVerdict = z.infer<typeof BabysitVerdictSchema>;

/**
 * The mutating agent's structured output (forced via claude `--json-schema`).
 * `dodMetSelfReport` is ADVISORY only — the deterministic `evaluateBabysitDoD`
 * verdict is the gate, never the agent's self-assessment.
 */
export const BabysitIterationResultSchema = z.object({
  summary: z.string().min(1),
  actionsTaken: z.array(z.string()),
  committed: z.boolean(),
  changedPaths: z.array(z.string()).default([]),
  commitMessage: z.string().optional(),
  dodMetSelfReport: z.boolean(),
  needsGuidance: z.boolean(),
  guidanceQuestion: z.string().optional(),
  intentConflict: z.boolean(),
  escalationReason: z.string().optional(),
});
export type BabysitIterationResult = z.infer<
  typeof BabysitIterationResultSchema
>;

/** Inline JSON schema handed to `claude -p --json-schema`. Must be a literal. */
export const BABYSIT_ITERATION_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "actionsTaken",
    "committed",
    "dodMetSelfReport",
    "needsGuidance",
    "intentConflict",
  ],
  properties: {
    summary: {
      type: "string",
      minLength: 1,
      description: "One-paragraph summary of what this iteration did.",
    },
    actionsTaken: {
      type: "array",
      items: { type: "string" },
      description: "Concrete actions taken (files edited, threads resolved).",
    },
    committed: {
      type: "boolean",
      description: "True if a git commit was made this iteration.",
    },
    changedPaths: {
      type: "array",
      items: { type: "string" },
      description: "Repo-relative paths committed this iteration.",
    },
    commitMessage: { type: "string" },
    dodMetSelfReport: {
      type: "boolean",
      description:
        "Agent's belief that the PR now meets the DoD. ADVISORY — not the gate.",
    },
    needsGuidance: {
      type: "boolean",
      description: "True if the agent is blocked and needs a human decision.",
    },
    guidanceQuestion: {
      type: "string",
      description: "The question to ask the human (required if needsGuidance).",
    },
    intentConflict: {
      type: "boolean",
      description:
        "True if a needed fix would conflict with the PR's intent (escalate).",
    },
    escalationReason: { type: "string" },
  },
};

/** Per-iteration cost/usage extracted from the claude result message. */
export type BabysitIterationCost = {
  costUsd: number | undefined;
  numTurns: number | undefined;
  durationMs: number;
};
