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
 * Verifier-target parameters declared by the specialist. The verification
 * activity reads these to run the empirical check — without them, only a
 * coarse-grained "rerun the whole suite" check is possible.
 *
 * Discriminated by `kind` so each verifier has type-safe access to the
 * parameters it needs. The runtime refinement on `FindingSchema` enforces
 * that `verifierTarget.kind === verifier`.
 */
export const VerifierTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("typecheck"),
    /** Workspace package path (e.g. `packages/temporal`). The verifier runs `bun run typecheck` here. */
    packagePath: z.string().min(1),
    /** Substring expected in the typecheck output if the claim is true (typically `file(line,col)` or the symbol name). */
    expectedOutputSubstring: z.string().min(1),
  }),
  z.object({
    kind: z.literal("eslint"),
    /** File path the verifier should lint. */
    filePath: z.string().min(1),
    /** ESLint rule id expected to fire (e.g. `no-restricted-syntax`). */
    ruleId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("grep"),
    /** ripgrep pattern (regex by default; literal if `isLiteral`). */
    pattern: z.string().min(1),
    /** If true, the verifier passes `-F` to ripgrep so the pattern is matched as a literal string. */
    isLiteral: z.boolean().default(false),
    /** Path glob to scope the search (e.g. `packages/temporal/src/**`). */
    pathGlob: z.string().min(1),
    /** `true`: the claim asserts the pattern EXISTS; `false`: the claim asserts it does NOT exist. */
    mustMatch: z.boolean(),
  }),
  z.object({
    kind: z.literal("test"),
    /** Workspace package path where the test lives. */
    packagePath: z.string().min(1),
    /** Pattern passed to `bun test --testNamePattern`. */
    testNamePattern: z.string().min(1),
    /** `true`: the claim asserts the test should PASS; `false`: it should FAIL. */
    expectPass: z.boolean(),
  }),
  z.object({
    kind: z.literal("none"),
    /** Reason no verifier applies (e.g. "subjective design call", "no empirical signal"). */
    reason: z.string().min(1),
  }),
]);
export type VerifierTarget = z.infer<typeof VerifierTargetSchema>;

/**
 * Result of running the declared verifier on a finding. Populated by the
 * verify activity. `status` drives the drop / keep decision:
 *   - `verified`     → verifier output supports the claim; keep + badge as verified
 *   - `unverified`   → verifier errored or could not determine; keep without badge
 *   - `contradicted` → verifier output refutes the claim; DROP the finding
 *
 * Convention: contradicted findings are dropped by the verify activity
 * itself; only `verified` and `unverified` findings appear downstream.
 */
export const VerificationStatusSchema = z.enum([
  "verified",
  "unverified",
  "contradicted",
]);

export const VerificationResultSchema = z.object({
  status: VerificationStatusSchema,
  /** Which verifier ran. May be `none` if the specialist declared no verifier. */
  verifier: FindingVerifierSchema,
  /** Verifier subprocess exit code; -1 if the verifier was skipped or errored before exec. */
  exitCode: z.number().int(),
  /** Truncated stdout/stderr excerpt (≤1000 chars) for dashboard surfacing. */
  outputExcerpt: z.string().max(1000),
  /** Wall-clock duration in milliseconds. */
  durationMs: z.number().int().nonnegative(),
  /** Optional human-readable note (`"timed out after 60s"`, `"workdir unavailable"`). */
  note: z.string().optional(),
});
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

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
  /** Stable id for dedupe / KV lookups. Hash of (file, lineStart, kind, claim). */
  id: z.string().min(1),
  /**
   * File path relative to repo root. Named `file` (not `path`) to match the
   * naming used in specialists' draft `src/shared/pr-review/schemas.ts`
   * (SpecialistFinding → AnnotatedFinding → ConsensusFinding → VerifiedFinding
   * stage layering); keeping the field name stable across both files lets the
   * stage schemas extend FindingSchema directly without translation.
   */
  file: z.string().min(1),
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
  /**
   * Verifier-specific parameters declared by the specialist (typecheck
   * package path, eslint rule id, grep pattern + path glob, test name).
   * The verify activity reads these to run an empirical check.
   *
   * Optional at the Finding-base level so that older callers (tests built
   * against the Phase 2 surface) still parse. The runner schema in the
   * Phase 4 specialist prompts adds a refinement requiring it when
   * `verifier !== "none"`. If absent, the verify activity treats the
   * finding as `unverified` rather than dropping.
   */
  verifierTarget: VerifierTargetSchema.optional(),
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
  /**
   * Populated by the verify activity. Undefined until then. Contradicted
   * findings are dropped by the verify activity itself, so postReview will
   * only see undefined | `verified` | `unverified`.
   */
  verification: VerificationResultSchema.optional(),
});

export type Finding = z.infer<typeof FindingSchema>;
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;
export type FindingKind = z.infer<typeof FindingKindSchema>;
export type FindingVerifier = z.infer<typeof FindingVerifierSchema>;
export type FindingVotes = z.infer<typeof FindingVotesSchema>;

export const FindingArraySchema = z.array(FindingSchema);
