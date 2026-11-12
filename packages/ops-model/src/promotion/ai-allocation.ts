import { z } from "zod/v4";

const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Identity = z.string().min(1).max(200);
const UsageRow = z
  .strictObject({
    apiKeyId: Identity,
    projectId: Identity,
    model: Identity,
    serviceTier: z.literal("default"),
    inputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    numModelRequests: z.number().int().nonnegative(),
  })
  .refine(
    (row) => row.cachedInputTokens <= row.inputTokens,
    "Cached tokens exceed input",
  );

export const PromotionAiAllocationRequestSchema = z
  .strictObject({
    version: z.literal(1),
    operation: z.enum(["plan", "apply"]).default("plan"),
    targetId: z.string().regex(/^[a-z0-9-]+$/),
    workflowId: Identity,
    runId: z.uuid(),
    executionStartedAt: z.iso.datetime(),
    executionClosedAt: z.iso.datetime(),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    expectedLedgerEtag: Identity.optional(),
    expectedRowSha256: Digest.optional(),
    expectedAuditId: Digest.optional(),
    provider: z.strictObject({
      startAt: z.iso.datetime(),
      endAt: z.iso.datetime(),
      observedAt: z.iso.datetime(),
      querySha256: Digest,
      responseSha256: Digest,
      apiKeyId: Identity,
      projectId: Identity,
      model: Identity,
      hasMore: z.literal(false),
      buckets: z
        .array(
          z.strictObject({
            startTime: z.number().int().nonnegative(),
            endTime: z.number().int().nonnegative(),
            results: z.array(UsageRow),
          }),
        )
        .min(1)
        .max(60),
    }),
    review: z.strictObject({
      operator: z.string().min(1).max(200),
      reason: z.string().min(20).max(2000),
      // Explicit review decisions, never inferred from an empty provider bucket.
      copiedAuthoritativeResponse: z.literal(true),
      coversWholeGeneration: z.literal(true),
      relevantProviderIdentity: z.literal(true),
      reportingCoverageAdequate: z.literal(true),
      allocationIsNotExactBilledUsage: z.literal(true),
      historicalModel: z
        .strictObject({
          model: Identity,
          evidenceSha256: Digest,
          evidenceReference: z.string().min(20).max(1000),
        })
        .optional(),
    }),
  })
  .refine(
    (input) =>
      input.operation !== "apply" ||
      (input.expectedLedgerEtag !== undefined &&
        input.expectedRowSha256 !== undefined &&
        input.expectedAuditId !== undefined),
    "Apply requires the reviewed ledger version, row digest and audit identity",
  );
export type PromotionAiAllocationRequest = z.infer<
  typeof PromotionAiAllocationRequestSchema
>;

export const PromotionAiBudgetAllocationSchema = z.strictObject({
  kind: z.literal("reviewed-provider-aggregate"),
  auditId: Digest,
  amountUsd: z.number().positive(),
});
export const PromotionAiLedgerRowSchema = z
  .strictObject({
    reservedUsd: z.number().nonnegative(),
    chargedUsd: z.number().nonnegative().nullable(),
    model: Identity.optional(),
    budgetAllocation: PromotionAiBudgetAllocationSchema.optional(),
  })
  .refine(
    (row) => row.budgetAllocation === undefined || row.chargedUsd === null,
    "An aggregate allocation cannot accompany an exact charge",
  );
export const PromotionAiLedgerSchema = z.record(
  z.string(),
  PromotionAiLedgerRowSchema,
);
export type PromotionAiLedgerRow = z.infer<typeof PromotionAiLedgerRowSchema>;

export const PromotionAiAllocationResultSchema = z.strictObject({
  auditId: Digest,
  catalogModelSha256: Digest,
  occurrenceId: Identity,
  allocatedUsd: z.number().positive(),
  exactUsage: z.literal("unknown"),
  status: z.enum(["planned", "allocated", "already-allocated"]),
  reviewedRequest: PromotionAiAllocationRequestSchema,
});
export type PromotionAiAllocationResult = z.infer<
  typeof PromotionAiAllocationResultSchema
>;

export function promotionAiAccounting(rows: readonly PromotionAiLedgerRow[]) {
  return {
    aiUsd: rows.reduce((sum, row) => sum + (row.chargedUsd ?? 0), 0),
    allocatedAiUsd: rows.reduce(
      (sum, row) => sum + (row.budgetAllocation?.amountUsd ?? 0),
      0,
    ),
    unknownAi: rows.filter((row) => row.chargedUsd === null).length,
    unallocatedUnknownAi: rows.filter(
      (row) => row.chargedUsd === null && row.budgetAllocation === undefined,
    ).length,
  };
}
