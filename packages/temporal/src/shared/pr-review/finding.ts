import { z } from "zod/v4";

/**
 * Severity bucket for a finding. Drives the section a comment is placed
 * under in the posted review (Critical / Warning / Nit).
 */
export const FindingSeveritySchema = z.enum(["critical", "warning", "nit"]);

/**
 * Specialist category that produced the finding. Required for consensus
 * voting (cross-specialist agreement) and downstream A/B analysis.
 */
export const FindingKindSchema = z.enum([
  "correctness",
  "security",
  "performance",
  "convention",
  "deps",
]);

/**
 * Verifier kind declared by the model. The verification activity uses this
 * to pick the empirical check that runs against the PR head — a claim that
 * fails its declared verifier is dropped before posting.
 */
export const FindingVerifierSchema = z.enum([
  "typecheck",
  "eslint",
  "grep",
  "test",
  "none",
]);

/**
 * Vote metadata attached after consensus clustering. Empty until the
 * consensusVote activity runs.
 */
export const FindingVotesSchema = z.object({
  withinSpecialist: z
    .number()
    .int()
    .nonnegative()
    .describe(
      "How many of the N randomized passes for this specialist produced this finding.",
    ),
  withinSpecialistTotal: z
    .number()
    .int()
    .positive()
    .describe("Total passes per specialist (typically 3)."),
  acrossSpecialists: z
    .number()
    .int()
    .nonnegative()
    .describe(
      "How many distinct specialist kinds produced this finding (1..5).",
    ),
});

/**
 * A single review comment as produced by a specialist. Every field is
 * required so the schema doubles as a contract for prompt outputs.
 */
export const FindingSchema = z.object({
  /** Stable id for dedupe / KV lookups. Hash of (path, lineStart, kind, claim). */
  id: z.string().min(1),
  /** File path relative to repo root. */
  path: z.string().min(1),
  /** Starting line number (1-indexed). */
  lineStart: z.number().int().positive(),
  /** Ending line number, inclusive. May equal lineStart for single-line findings. */
  lineEnd: z.number().int().positive(),
  /** Specialist category that produced this. */
  kind: FindingKindSchema,
  /** Severity bucket (drives section grouping in the posted comment). */
  severity: FindingSeveritySchema,
  /** Which verifier the model claims would prove the bug. */
  verifier: FindingVerifierSchema,
  /** One-sentence claim ("this line ignores the error from fooBar"). */
  claim: z.string().min(1),
  /** Concrete supporting evidence (snippet of code, cross-file reference, doc quote). */
  evidence: z.string().min(1),
  /** Self-reported confidence 0..1 from the producing specialist. */
  confidence: z.number().min(0).max(1),
  /**
   * Populated by the consensus activity. Undefined until then; required to
   * be present in postReview input.
   */
  votes: FindingVotesSchema.optional(),
});

export type Finding = z.infer<typeof FindingSchema>;
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;
export type FindingKind = z.infer<typeof FindingKindSchema>;
export type FindingVerifier = z.infer<typeof FindingVerifierSchema>;
export type FindingVotes = z.infer<typeof FindingVotesSchema>;

export const FindingArraySchema = z.array(FindingSchema);
