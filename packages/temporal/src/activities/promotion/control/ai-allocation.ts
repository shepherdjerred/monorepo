import { createHash } from "node:crypto";
import {
  PromotionAiAllocationRequestSchema,
  PromotionAiAllocationResultSchema,
  PromotionAiLedgerSchema,
  type PromotionAiAllocationRequest,
} from "@shepherdjerred/ops-model/promotion/ai-allocation.ts";
import { z } from "zod/v4";
import { createTemporalReadClient } from "#client";
import { parseTemporalNamespace } from "#shared/infra/temporal-namespace.ts";
import {
  promotionStore,
  type PromotionStore,
} from "#activities/promotion/store.ts";
import { promotionTarget } from "#activities/promotion/manifest.ts";
import { pricePromotionAiEvidence } from "./ai-allocation-evidence.ts";

export function promotionAccountingHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export type ClosedPromotionExecution = {
  workflowId: string;
  type: string;
  runId: string;
  startedAt: string;
  closedAt: string;
  status: string;
};

const AuditSchema = z.strictObject({
  version: z.literal(1),
  request: PromotionAiAllocationRequestSchema,
  execution: z.strictObject({
    workflowId: z.string(),
    type: z.literal("runStormPromotion"),
    runId: z.string(),
    startedAt: z.string(),
    closedAt: z.string(),
    status: z.string(),
  }),
  catalogModelSha256: z.string(),
  amountUsd: z.number().positive(),
  normalizedProviderResponseSha256: z.string(),
  certainty: z.literal("reviewed-allocation-exact-usage-unknown"),
});

function assertClosedExecution(
  input: PromotionAiAllocationRequest,
  execution: ClosedPromotionExecution,
) {
  if (
    execution.workflowId !== input.workflowId ||
    execution.type !== "runStormPromotion" ||
    execution.runId !== input.runId ||
    !["COMPLETED", "FAILED", "CANCELLED", "TERMINATED", "TIMED_OUT"].includes(
      execution.status,
    ) ||
    execution.startedAt !== input.executionStartedAt ||
    execution.closedAt !== input.executionClosedAt ||
    Date.parse(execution.closedAt) < Date.parse(execution.startedAt)
  )
    throw new Error(
      "Original Workflow is not the exact reviewed closed execution",
    );
}

async function readAllocationEntry(
  input: PromotionAiAllocationRequest,
  store: PromotionStore,
  occurrenceId: string,
) {
  const ledgerKey = `ai/daily/${input.day}.json`;
  const ledger = await store.read(ledgerKey, PromotionAiLedgerSchema);
  if (ledger === undefined)
    throw new Error(
      "Expected original unknown AI ledger entry is missing or already exact",
    );
  const row = ledger.value[occurrenceId];
  if (row?.chargedUsd !== null)
    throw new Error(
      "Expected original unknown AI ledger entry is missing or already exact",
    );
  const historicalModel = row.model ?? input.review.historicalModel?.model;
  if (historicalModel !== input.provider.model)
    throw new Error(
      "Reviewed provider model differs from the recorded execution model",
    );
  if (
    input.review.historicalModel !== undefined &&
    input.review.historicalModel.model !== input.provider.model
  )
    throw new Error(
      "Historical model evidence contradicts the reviewed provider model",
    );
  const previousAudit =
    row.budgetAllocation === undefined
      ? undefined
      : await store.read(
          `ai/allocations/${row.budgetAllocation.auditId}.json`,
          AuditSchema,
        );
  const reviewedRequest = PromotionAiAllocationRequestSchema.parse({
    ...input,
    operation: "plan",
    expectedAuditId: input.expectedAuditId ?? row.budgetAllocation?.auditId,
    expectedLedgerEtag:
      input.expectedLedgerEtag ??
      previousAudit?.value.request.expectedLedgerEtag ??
      ledger.etag,
    expectedRowSha256:
      input.expectedRowSha256 ??
      previousAudit?.value.request.expectedRowSha256 ??
      promotionAccountingHash(row),
  });
  return { ledgerKey, ledger, row, reviewedRequest, previousAudit };
}

type AllocationEntry = Awaited<ReturnType<typeof readAllocationEntry>>;

function auditRequest(request: PromotionAiAllocationRequest) {
  // The expected identity guards the completed intent; it cannot hash itself.
  return PromotionAiAllocationRequestSchema.parse({
    ...request,
    operation: "plan",
    expectedAuditId: undefined,
  });
}

function committedAllocation(
  entry: AllocationEntry,
  occurrenceId: string,
  execution: ClosedPromotionExecution,
) {
  const allocation = entry.row.budgetAllocation;
  if (allocation === undefined) return;
  const saved = entry.previousAudit?.value;
  if (
    saved === undefined ||
    promotionAccountingHash(saved) !== allocation.auditId ||
    saved.amountUsd !== allocation.amountUsd ||
    (entry.reviewedRequest.expectedAuditId !== undefined &&
      entry.reviewedRequest.expectedAuditId !== allocation.auditId) ||
    promotionAccountingHash(saved.request) !==
      promotionAccountingHash(auditRequest(entry.reviewedRequest)) ||
    promotionAccountingHash(saved.execution) !==
      promotionAccountingHash(AuditSchema.shape.execution.parse(execution))
  )
    throw new Error(
      "Occurrence already has a different or unaudited allocation",
    );
  return PromotionAiAllocationResultSchema.parse({
    auditId: allocation.auditId,
    catalogModelSha256: saved.catalogModelSha256,
    occurrenceId,
    allocatedUsd: saved.amountUsd,
    exactUsage: "unknown",
    status: "already-allocated",
    reviewedRequest: {
      ...entry.reviewedRequest,
      operation: "apply",
      expectedAuditId: allocation.auditId,
    },
  });
}

async function persistAllocation(input: {
  store: PromotionStore;
  entry: AllocationEntry;
  occurrenceId: string;
  audit: z.infer<typeof AuditSchema>;
  auditId: string;
}) {
  const { store, entry, occurrenceId, audit, auditId } = input;
  const auditKey = `ai/allocations/${auditId}.json`;
  if (!(await store.put(auditKey, audit, undefined))) {
    const existing = await store.read(auditKey, AuditSchema);
    if (
      existing === undefined ||
      promotionAccountingHash(existing.value) !== auditId
    )
      throw new Error(
        "Immutable allocation audit conflicts with reviewed intent",
      );
  }
  const changed = {
    ...entry.ledger.value,
    [occurrenceId]: {
      ...entry.row,
      budgetAllocation: {
        kind: "reviewed-provider-aggregate",
        auditId,
        amountUsd: audit.amountUsd,
      },
    },
  };
  if (
    !(await store.put(
      entry.ledgerKey,
      PromotionAiLedgerSchema.parse(changed),
      entry.ledger.etag,
    ))
  )
    throw new Error(
      "AI ledger changed before allocation; immutable intent retained, no retry",
    );
  const readback = await store.read(entry.ledgerKey, PromotionAiLedgerSchema);
  const savedRow = readback?.value[occurrenceId];
  if (
    savedRow === undefined ||
    promotionAccountingHash(savedRow) !==
      promotionAccountingHash(changed[occurrenceId])
  )
    throw new Error("AI allocation readback differs from the reviewed write");
}

/** One reviewed intent, one conditional ledger write. This never calls a provider. */
export async function allocatePromotionAiWithEvidence(
  raw: unknown,
  dependencies: {
    store: PromotionStore;
    inspectExecution: (
      workflowId: string,
      runId: string,
    ) => Promise<ClosedPromotionExecution>;
  },
) {
  const input = PromotionAiAllocationRequestSchema.parse(raw);
  if (input.workflowId !== `storm-promotion/${input.targetId}`)
    throw new Error("Allocation Workflow identity does not match its target");
  const occurrenceId = `${input.workflowId}/${input.runId}`;
  const execution = await dependencies.inspectExecution(
    input.workflowId,
    input.runId,
  );
  assertClosedExecution(input, execution);
  const entry = await readAllocationEntry(
    input,
    dependencies.store,
    occurrenceId,
  );
  const committed = committedAllocation(entry, occurrenceId, execution);
  if (committed !== undefined) return committed;
  const priced = pricePromotionAiEvidence(input);
  const { row, ledger } = entry;
  const audit = AuditSchema.parse({
    version: 1,
    request: auditRequest(entry.reviewedRequest),
    execution,
    catalogModelSha256: promotionAccountingHash(priced.model),
    amountUsd: priced.amountUsd,
    normalizedProviderResponseSha256: promotionAccountingHash(
      input.provider.buckets,
    ),
    certainty: "reviewed-allocation-exact-usage-unknown",
  });
  const auditId = promotionAccountingHash(audit);
  const reviewedRequest = PromotionAiAllocationRequestSchema.parse({
    ...entry.reviewedRequest,
    operation: "apply",
    expectedAuditId: auditId,
  });
  if (input.operation === "apply" && input.expectedAuditId !== auditId)
    throw new Error(
      "Computed AI allocation differs from the reviewed audit identity; request a new plan",
    );
  if (
    ledger.etag !== reviewedRequest.expectedLedgerEtag ||
    promotionAccountingHash(row) !== reviewedRequest.expectedRowSha256
  )
    throw new Error("Unknown AI ledger entry changed after review");
  if (input.operation === "plan")
    return PromotionAiAllocationResultSchema.parse({
      auditId,
      catalogModelSha256: audit.catalogModelSha256,
      occurrenceId,
      allocatedUsd: priced.amountUsd,
      exactUsage: "unknown",
      status: "planned",
      reviewedRequest,
    });
  await persistAllocation({
    store: dependencies.store,
    entry,
    occurrenceId,
    audit,
    auditId,
  });
  return PromotionAiAllocationResultSchema.parse({
    auditId,
    catalogModelSha256: audit.catalogModelSha256,
    occurrenceId,
    allocatedUsd: priced.amountUsd,
    exactUsage: "unknown",
    status: "allocated",
    reviewedRequest,
  });
}

export async function allocatePromotionAi(raw: unknown) {
  const input = PromotionAiAllocationRequestSchema.parse(raw);
  promotionTarget(input.targetId);
  const namespace = parseTemporalNamespace(Bun.env["TEMPORAL_NAMESPACE"]);
  if (namespace !== "prod")
    throw new Error("Operator AI allocation requires the production namespace");
  const client = await createTemporalReadClient(namespace);
  return await allocatePromotionAiWithEvidence(input, {
    store: promotionStore(),
    inspectExecution: async (workflowId, runId) => {
      const description = await client.workflow
        .getHandle(workflowId, runId)
        .describe();
      if (description.closeTime === undefined)
        throw new Error("Original promotion Workflow is still running");
      return {
        workflowId: description.workflowId,
        type: description.type,
        runId: description.runId,
        startedAt: description.startTime.toISOString(),
        closedAt: description.closeTime.toISOString(),
        status: description.status.name,
      };
    },
  });
}
