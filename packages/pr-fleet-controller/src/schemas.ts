import { z } from "zod";

export const PrStatusSchema = z.enum([
  "new",
  "queued",
  "diagnosing",
  "waiting-write-lease",
  "editing",
  "verifying",
  "waiting-ci",
  "waiting-review",
  "waiting-for-answer",
  "paused",
  "green",
  "closed",
]);

export const ClassificationSchema = z.enum([
  "green",
  "pending",
  "actionable-red",
  "conflict",
  "waiting-for-answer",
  "paused",
  "queued",
]);

export const PrIdentitySchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.url(),
  draft: z.boolean(),
  author: z.string(),
  // GitHub author association type. "Bot" lets the review-gate skip policy
  // apply (some providers cannot emit a completion signal for bot authors).
  authorType: z.enum(["Bot", "User"]).default("User"),
  labels: z.array(z.string()),
  headRefName: z.string().min(1),
  headSha: z.string().regex(/^[0-9a-f]{40}$/),
  baseRefName: z.string().min(1),
  crossRepository: z.boolean(),
  maintainerCanModify: z.boolean(),
});

export const CheckEvidenceSchema = z.object({
  name: z.string(),
  state: z.string(),
  bucket: z.string(),
  link: z.url().nullable(),
  softFail: z.boolean(),
});

export const ReviewFindingSchema = z.object({
  id: z.string(),
  author: z.string(),
  body: z.string(),
  severity: z.enum(["P0", "P1", "P2", "P3", "unknown"]),
  resolved: z.boolean(),
  outdated: z.boolean(),
});

export const BuildkiteFailureSchema = z.object({
  jobId: z.string(),
  name: z.string(),
  state: z.string(),
  webUrl: z.url(),
  startedAt: z.iso.datetime().nullable(),
  log: z.string(),
});

export const ReadinessEvidenceSchema = z.object({
  headSha: z.string().regex(/^[0-9a-f]{40}$/),
  checks: z.array(CheckEvidenceSchema),
  buildkiteCurrentHead: z.boolean(),
  buildkiteFailure: BuildkiteFailureSchema.nullable(),
  conflict: z.boolean(),
  reviewFindings: z.array(ReviewFindingSchema),
  hostedReviewComplete: z.boolean(),
  hardFailureFingerprint: z.string().nullable(),
  reviewFingerprint: z.string().nullable(),
});

export const OperatorQuestionOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  recommended: z.boolean(),
});

export const OperatorQuestionSchema = z
  .object({
    id: z.string().min(1),
    header: z.string().min(1).max(80),
    question: z.string().min(1).max(1000),
    options: z.array(OperatorQuestionOptionSchema).min(2).max(3),
  })
  .superRefine((question, context) => {
    const recommended = question.options.filter((option) => option.recommended);
    if (recommended.length !== 1) {
      context.addIssue({
        code: "custom",
        message: "Exactly one operator-question option must be recommended",
        path: ["options"],
      });
    }
    const optionIds = new Set(question.options.map((option) => option.id));
    if (optionIds.size !== question.options.length) {
      context.addIssue({
        code: "custom",
        message: "Operator-question option IDs must be unique",
        path: ["options"],
      });
    }
  });

const OperatorInputRequestDraftFields = {
  context: z.string().min(1).max(4000),
  questions: z.array(OperatorQuestionSchema).min(1).max(3),
};

export const OperatorInputRequestDraftSchema = z
  .object(OperatorInputRequestDraftFields)
  .superRefine((request, context) => {
    const questionIds = new Set(
      request.questions.map((question) => question.id),
    );
    if (questionIds.size !== request.questions.length) {
      context.addIssue({
        code: "custom",
        message: "Operator-question IDs must be unique",
        path: ["questions"],
      });
    }
  });

export const OperatorInputRequestSchema = z
  .object({
    id: z.string().min(1),
    pr: z.number().int().positive(),
    headSha: z.string().regex(/^[0-9a-f]{40}$/),
    generation: z.number().int().nonnegative(),
    ...OperatorInputRequestDraftFields,
    createdAt: z.iso.datetime(),
  })
  .superRefine((request, context) => {
    const questionIds = new Set(
      request.questions.map((question) => question.id),
    );
    if (questionIds.size !== request.questions.length) {
      context.addIssue({
        code: "custom",
        message: "Operator-question IDs must be unique",
        path: ["questions"],
      });
    }
  });

export const OperatorQuestionAnswerSchema = z
  .object({
    questionId: z.string().min(1),
    optionId: z.string().min(1).nullable().default(null),
    freeText: z.string().min(1).max(4000).nullable().default(null),
  })
  .superRefine((answer, context) => {
    if (answer.optionId === null && answer.freeText === null) {
      context.addIssue({
        code: "custom",
        message: "An option or free-text answer is required",
      });
    }
  });

export const OperatorInputAnswerSchema = z
  .object({
    requestId: z.string().min(1),
    answers: z.array(OperatorQuestionAnswerSchema).min(1).max(3),
  })
  .superRefine((answer, context) => {
    const questionIds = new Set(
      answer.answers.map((response) => response.questionId),
    );
    if (questionIds.size !== answer.answers.length) {
      context.addIssue({
        code: "custom",
        message: "Operator-answer question IDs must be unique",
        path: ["answers"],
      });
    }
  });

export const WorktreeContextSchema = z.object({
  ownership: z.enum(["fleet", "operator"]),
  remoteHeadSha: z.string().regex(/^[0-9a-f]{40}$/),
  localHeadSha: z.string().regex(/^[0-9a-f]{40}$/),
  relation: z.enum(["exact", "ahead", "behind", "diverged"]),
  dirty: z.boolean(),
  stagedPaths: z.array(z.string()),
  unstagedPaths: z.array(z.string()),
});

export const PrStateSchema = z.object({
  identity: PrIdentitySchema,
  logicalOwner: z.string(),
  runtimeAgent: z.string().nullable(),
  agentGeneration: z.number().int().nonnegative(),
  model: z.string(),
  status: PrStatusSchema,
  classification: ClassificationSchema,
  stackId: z.string(),
  worktree: z.string().nullable(),
  worktreeContext: WorktreeContextSchema.nullable().default(null),
  setupComplete: z.boolean(),
  evidence: ReadinessEvidenceSchema,
  lastAgentReportAt: z.iso.datetime().nullable(),
  lastProgressAt: z.iso.datetime(),
  noProgressTicks: z.number().int().nonnegative(),
  prodSentAt: z.iso.datetime().nullable(),
  escalation: z.string().nullable(),
  operatorRequest: OperatorInputRequestSchema.nullable().default(null),
  priority: z.number().int(),
});

export const FleetSnapshotSchema = z.object({
  open: z.number().int().nonnegative(),
  green: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  // Schema-v1 bundles predate operator questions. Defaulting only this additive
  // aggregate keeps those immutable bundles readable while replay still checks
  // the count against current waiting-for-answer PR states.
  waiting: z.number().int().nonnegative().default(0),
  paused: z.number().int().nonnegative(),
  prs: z.array(PrStateSchema),
});

export const TickTriggerSchema = z.enum([
  "startup",
  "heartbeat",
  "worker-complete",
  "user",
  "due",
]);

export const FleetTickReportSchema = z.object({
  trigger: TickTriggerSchema,
  snapshot: FleetSnapshotSchema,
  changes: z.array(z.string()),
  nextHeartbeatSeconds: z.union([z.literal(300), z.literal(600)]),
});

export const LeaseKindSchema = z.enum(["setup", "heavy", "stack-write"]);

export const WorkerResultSchema = z
  .object({
    pr: z.number().int().positive(),
    state: z.enum([
      "pushed",
      "green",
      "waiting-ci",
      "waiting-review",
      "needs-setup-lease",
      "needs-heavy-lease",
      "needs-write-lease",
      "waiting-for-answer",
      "blocked",
      "escalation",
    ]),
    headShaBefore: z.string(),
    headShaAfter: z.string().nullable(),
    hardFailures: z.array(z.string()),
    reviewFindings: z.array(z.string()),
    conflict: z.boolean(),
    validation: z.array(z.string()),
    lastAction: z.string(),
    blockers: z.array(z.string()),
    operatorRequestId: z.string().min(1).nullable().optional(),
    worktree: z.string().nullable(),
    worktreeDirty: z.boolean(),
    setupLeaseReleased: z.boolean(),
    heavyLeaseReleased: z.boolean(),
    writeLeaseReleased: z.boolean(),
  })
  .superRefine((result, context) => {
    const waiting = result.state === "waiting-for-answer";
    if (waiting !== (result.operatorRequestId != null)) {
      context.addIssue({
        code: "custom",
        message:
          "waiting-for-answer requires operatorRequestId, and other states must not set it",
        path: ["operatorRequestId"],
      });
    }
  });

export const FleetControllerConfigSchema = z.object({
  model: z.string().regex(/^[a-z0-9][\w.-]*\/[^/]+$/i),
  repo: z.string().regex(/^[^/]+\/[^/]+$/),
  checkout: z.string().min(1),
  worktreeRoot: z.string().min(1),
  maxWorkers: z.number().int().min(1).max(5),
  author: z.string().min(1).nullable().optional(),
});

export type PrIdentity = z.infer<typeof PrIdentitySchema>;
export type CheckEvidence = z.infer<typeof CheckEvidenceSchema>;
export type Classification = z.infer<typeof ClassificationSchema>;
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;
export type BuildkiteFailure = z.infer<typeof BuildkiteFailureSchema>;
export type ReadinessEvidence = z.infer<typeof ReadinessEvidenceSchema>;
export type OperatorQuestionOption = z.infer<
  typeof OperatorQuestionOptionSchema
>;
export type OperatorQuestion = z.infer<typeof OperatorQuestionSchema>;
export type OperatorInputRequest = z.infer<typeof OperatorInputRequestSchema>;
export type OperatorInputRequestDraft = z.infer<
  typeof OperatorInputRequestDraftSchema
>;
export type OperatorQuestionAnswer = z.infer<
  typeof OperatorQuestionAnswerSchema
>;
export type OperatorInputAnswer = z.infer<typeof OperatorInputAnswerSchema>;
export type WorktreeContext = z.infer<typeof WorktreeContextSchema>;
export type PrState = z.infer<typeof PrStateSchema>;
export type FleetSnapshot = z.infer<typeof FleetSnapshotSchema>;
export type FleetTickReport = z.infer<typeof FleetTickReportSchema>;
export type TickTrigger = z.infer<typeof TickTriggerSchema>;
export type LeaseKind = z.infer<typeof LeaseKindSchema>;
export type WorkerResult = z.infer<typeof WorkerResultSchema>;
export type FleetControllerConfig = z.infer<typeof FleetControllerConfigSchema>;
