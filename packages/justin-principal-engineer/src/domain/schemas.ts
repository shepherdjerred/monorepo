import { z } from "zod";

export const ProviderSchema = z.enum(["codex"]);
export type Provider = z.infer<typeof ProviderSchema>;

export const TaskPhaseSchema = z.enum([
  "claiming",
  "claimed",
  "implementing",
  "publishing",
  "awaiting_ci",
  "awaiting_approval",
  "merging",
  "completing",
  "needs_human",
  "blocked",
  "done",
]);
export type TaskPhase = z.infer<typeof TaskPhaseSchema>;

export const LinearIssueSchema = z.object({
  id: z.string().min(1),
  identifier: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable().default(null),
  url: z.url(),
  priority: z.number().int(),
  team: z.object({ key: z.string().min(1) }).optional(),
  project: z
    .object({ id: z.string().min(1), name: z.string().min(1) })
    .nullable()
    .optional(),
  createdAt: z.string().min(1),
  state: z.object({
    name: z.string().min(1),
    type: z.string().min(1),
  }),
  labels: z.object({
    nodes: z.array(z.object({ name: z.string().min(1) })),
  }),
});
export type LinearIssue = z.infer<typeof LinearIssueSchema>;

export const FeedbackSchema = z.object({
  id: z.string().min(1),
  source: z.enum(["issue_comment", "review", "inline_comment"]),
  body: z.string(),
  createdAt: z.string().min(1),
  url: z.url().nullable(),
});
export type Feedback = z.infer<typeof FeedbackSchema>;

export const ReviewFindingRefSchema = z.object({
  provider: z.enum(["codex", "coderabbit"]),
  key: z.string().min(1),
});
export type ReviewFindingRef = z.infer<typeof ReviewFindingRefSchema>;

const VisualTargetSchema = z.object({
  package: z.string().min(1),
  // NOTE: .regex() on purpose. z.toJSONSchema renders .startsWith()
  // as {"format": "starts_with"}, which strict structured-output
  // providers reject; .regex() renders {"pattern": ...} instead.
  route: z.string().regex(/^\//, "Route must start with /"),
  name: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  waitForSelector: z.string().min(1).optional(),
});

export const AgentOutputSchema = z.object({
  status: z.enum(["changed", "no_change", "needs_human"]),
  commitTitle: z
    .string()
    .regex(
      /^(feat|fix|docs|refactor|perf|test|build|ci|chore)\([a-z0-9][a-z0-9-]*\): .+$/,
    ),
  summary: z.string().min(1),
  verification: z.array(z.string()),
  resolvedFindingKeys: z.array(z.string().min(1)).default([]),
  resolvedFindings: z.array(ReviewFindingRefSchema).default([]),
  visualTargets: z.array(VisualTargetSchema).default([]),
});
export type AgentOutput = z.infer<typeof AgentOutputSchema>;

// Strict structured-output providers require every property in `required`,
// with absence modeled as null rather than omission. This wire twin derives
// from the semantic shape so the two cannot drift; parse the model response
// with it first, map nulls back to undefined, then validate AgentOutputSchema
// as usual. schemas.test.ts guards the strict invariants (no string formats,
// complete `required` coverage).
export const AgentOutputWireSchema = z.object({
  status: AgentOutputSchema.shape.status,
  commitTitle: AgentOutputSchema.shape.commitTitle,
  summary: AgentOutputSchema.shape.summary,
  verification: AgentOutputSchema.shape.verification,
  resolvedFindingKeys: z.array(z.string().min(1)),
  resolvedFindings: z.array(ReviewFindingRefSchema),
  visualTargets: z.array(
    VisualTargetSchema.extend({
      waitForSelector: z.string().min(1).nullable(),
    }),
  ),
});
export type AgentOutputWire = z.infer<typeof AgentOutputWireSchema>;

export const AgentTurnInputSchema = z.object({
  provider: ProviderSchema,
  model: z.string().min(1),
  prompt: z.string().min(1),
});
export type AgentTurnInput = z.infer<typeof AgentTurnInputSchema>;

const OpReferenceSchema = z.string().startsWith("op://");

export const ConfigSchema = z.object({
  autonomy: z
    .object({
      enabledIssueIdentifiers: z
        .array(z.string().regex(/^AI-[1-9]\d*$/))
        .default([]),
    })
    .default({ enabledIssueIdentifiers: [] }),
  repository: z.object({
    stableCheckout: z.string().startsWith("/"),
    slug: z.string().regex(/^[^/]+\/[^/]+$/),
    baseBranch: z.string().min(1).default("main"),
  }),
  linear: z.object({
    team: z.string().min(1).default("SJ"),
    apiKey: OpReferenceSchema,
  }),
  woodpecker: z.object({
    apiToken: OpReferenceSchema,
    baseUrl: z.url(),
    repoId: z.number().int().positive(),
  }),
  pinchtab: z.object({ configPath: z.string().startsWith("/") }),
  github: z.object({
    appId: OpReferenceSchema,
    installationId: OpReferenceSchema,
    privateKey: OpReferenceSchema,
    approverLogin: z.string().min(1),
    approverId: z.number().int().positive(),
    botLogin: z.string().min(1).default("justin-principal-engineer[bot]"),
  }),
  agents: z.object({
    codex: z.object({
      openAiApiKey: OpReferenceSchema,
      model: z.string().min(1).default("gpt-5.6-luna"),
    }),
  }),
  docker: z.object({
    image: z.string().min(1).optional(),
    platform: z.enum(["linux/amd64", "linux/arm64"]).default("linux/amd64"),
    turnTimeoutMinutes: z.number().int().min(1).max(120).default(45),
  }),
});
export type Config = z.infer<typeof ConfigSchema>;

export const PrHealthSchema = z.object({
  prNumber: z.number().int().positive(),
  prUrl: z.url(),
  overallStatus: z.enum(["HEALTHY", "UNHEALTHY", "PENDING"]),
  checks: z.array(
    z.object({
      name: z.string(),
      status: z.enum(["HEALTHY", "UNHEALTHY", "PENDING"]),
      details: z.array(z.string()),
      commands: z.array(z.string()).optional(),
    }),
  ),
  nextSteps: z.array(z.string()),
});
export type PrHealth = z.infer<typeof PrHealthSchema>;

export const TaskStateSchema = z.object({
  issue: LinearIssueSchema,
  provider: ProviderSchema,
  deliveryMode: z
    .enum(["owner_approved", "autonomous"])
    .default("owner_approved"),
  repairTurnsUsed: z.number().int().nonnegative().default(0),
  implementationStarted: z.boolean().default(false),
  autonomyReviewPending: z.boolean().default(true),
  blockedReason: z.string().nullable().default(null),
  blockedFromPhase: TaskPhaseSchema.nullable().default(null),
  nextAttemptAt: z.iso.datetime().nullable().default(null),
  blockedAttempts: z.number().int().nonnegative().default(0),
  mergeCommitSha: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .nullable()
    .default(null),
  phase: TaskPhaseSchema,
  resumePhase: TaskPhaseSchema.nullable(),
  branch: z.string().min(1),
  checkoutPath: z.string().min(1),
  prNumber: z.number().int().positive().nullable(),
  prUrl: z.url().nullable(),
  latestHeadSha: z.string().nullable(),
  lastAgentOutput: AgentOutputSchema.nullable(),
  pendingFeedback: z.array(FeedbackSchema),
  pendingHealth: PrHealthSchema.nullable(),
  pendingDiagnostics: z.string().nullable(),
  pendingCodexFindingKeys: z.array(z.string().min(1)).default([]),
  pendingReviewFindings: z.array(ReviewFindingRefSchema).default([]),
  restackInProgress: z.boolean().default(false),
  evidencePublished: z.boolean(),
  evidenceMarkdown: z.array(z.string()),
  seenFeedbackIds: z.array(z.string()),
  failureCount: z.number().int().nonnegative(),
  lastFailureFingerprint: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type TaskState = z.infer<typeof TaskStateSchema>;
