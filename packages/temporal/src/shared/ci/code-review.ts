import { z } from "zod";
import {
  ProviderIdSchema,
  type ProviderId,
  type ProviderWeights,
  type PullRequestAuthor,
  type SmoothWeightedState,
  type WeightedSelectionOutcome,
} from "@shepherdjerred/code-review";

export const CODE_REVIEW_STATUS_CONTEXT = "ci/code-review";
export const CODE_REVIEW_COORDINATOR_WORKFLOW_ID = "code-review-coordinator";

export function prCodeReviewWorkflowId(
  owner: string,
  repo: string,
  prNumber: number,
): string {
  return `pr-code-review-${owner}-${repo}-${String(prNumber)}`;
}

const NonNegativeWeightSchema = z.number().int().min(0);
const PositiveSecondsSchema = z.number().int().min(1);

export const ProviderWeightsSchema = z
  .strictObject({
    codex: NonNegativeWeightSchema.optional(),
    greptile: NonNegativeWeightSchema.optional(),
    qodo: NonNegativeWeightSchema.optional(),
    coderabbit: NonNegativeWeightSchema.optional(),
    cubic: NonNegativeWeightSchema.optional(),
    codeant: NonNegativeWeightSchema.optional(),
  })
  .transform((raw): ProviderWeights => {
    const weights: ProviderWeights = {};
    for (const id of ProviderIdSchema.options) {
      const value = raw[id];
      if (value !== undefined) {
        weights[id] = value;
      }
    }
    return weights;
  });

export const CodeReviewSettingsSchema = z.strictObject({
  weights: ProviderWeightsSchema,
  quotaCooldownSeconds: PositiveSecondsSchema.default(3600),
  timeoutCooldownSeconds: PositiveSecondsSchema.default(900),
  requestRetrySeconds: PositiveSecondsSchema.default(720),
  providerTimeoutSeconds: PositiveSecondsSchema.default(1500),
});

export type CodeReviewSettings = z.infer<typeof CodeReviewSettingsSchema>;

export const DEFAULT_CODE_REVIEW_SETTINGS: CodeReviewSettings = {
  weights: {
    coderabbit: 3,
    codex: 1,
    cubic: 0,
    codeant: 0,
    qodo: 0,
    greptile: 0,
  },
  quotaCooldownSeconds: 3600,
  timeoutCooldownSeconds: 900,
  requestRetrySeconds: 720,
  providerTimeoutSeconds: 1500,
};

export const DEFAULT_CODE_REVIEW_SETTINGS_JSON =
  '{"weights":{"coderabbit":3,"codex":1,"cubic":0,"codeant":0,"qodo":0,"greptile":0},"quotaCooldownSeconds":3600,"timeoutCooldownSeconds":900,"requestRetrySeconds":720,"providerTimeoutSeconds":1500}';

export const PullRequestAuthorSchema = z.strictObject({
  login: z.string().min(1),
  type: z.string().min(1),
});

export const ClaimProviderSignalPayloadSchema = z.strictObject({
  requestId: z.string().min(1),
  replyWorkflowId: z.string().min(1),
  replyRunId: z.string().min(1),
  prNumber: z.number().int().positive(),
  headSha: z.string().min(1),
  author: PullRequestAuthorSchema,
  weights: ProviderWeightsSchema,
  excludeProviders: z.array(ProviderIdSchema),
  nowMs: z.number(),
});

export type ClaimProviderSignalPayload = {
  requestId: string;
  replyWorkflowId: string;
  replyRunId: string;
  prNumber: number;
  headSha: string;
  author: PullRequestAuthor;
  weights: ProviderWeights;
  excludeProviders: ProviderId[];
  nowMs: number;
};

export const WeightedSelectionOutcomeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("assigned"),
    providerId: ProviderIdSchema,
  }),
  z.strictObject({
    kind: z.literal("exhausted"),
    reason: z.enum(["all-blocked", "all-skipped", "no-configured-providers"]),
  }),
]);

export const ProviderAssignmentPayloadSchema = z.strictObject({
  requestId: z.string().min(1),
  selection: WeightedSelectionOutcomeSchema,
});

export type ProviderAssignmentPayload = {
  requestId: string;
  selection: WeightedSelectionOutcome;
};

export const ProviderOutcomeKindSchema = z.enum([
  "completed",
  "usage-limited",
  "timed-out",
  "skipped",
]);

export type ProviderOutcomeKind = z.infer<typeof ProviderOutcomeKindSchema>;

export const ReportProviderOutcomePayloadSchema = z.strictObject({
  providerId: ProviderIdSchema,
  outcome: ProviderOutcomeKindSchema,
  cooldownMs: z.number().int().min(0),
  nowMs: z.number(),
});

export type ReportProviderOutcomePayload = z.infer<
  typeof ReportProviderOutcomePayloadSchema
>;

export const PrCodeReviewWorkflowInputSchema = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
  prNumber: z.number().int().positive(),
  headSha: z.string().min(1),
  baseRef: z.string().min(1),
  watchIteration: z.number().int().min(0).optional(),
  assignedProviderId: ProviderIdSchema.nullable().optional(),
});

export type PrCodeReviewWorkflowInput = {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  baseRef: string;
  watchIteration?: number | undefined;
  assignedProviderId?: ProviderId | null | undefined;
};

export const BackfillOpenPrCodeReviewsInputSchema = z.strictObject({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

export type BackfillOpenPrCodeReviewsInput = z.infer<
  typeof BackfillOpenPrCodeReviewsInputSchema
>;

export type BackfillOpenPrCodeReviewsResult = {
  startedCount: number;
  prNumbers: number[];
};

export type CodeReviewCoordinatorState = {
  weighted: SmoothWeightedState;
  processedCount: number;
};
