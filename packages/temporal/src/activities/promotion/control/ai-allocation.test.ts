import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  PromotionAiAllocationRequestSchema,
  PromotionAiLedgerSchema,
} from "@shepherdjerred/ops-model/promotion/ai-allocation.ts";
import { memoryPromotionStore } from "#activities/promotion/test-support.ts";
import {
  allocatePromotionAiWithEvidence,
  promotionAccountingHash,
} from "./ai-allocation.ts";
import { promotionSpendDay, reservePromotionAi } from "./budget.ts";
import { readPromotionSpend, readProductionPromotionStatus } from "./status.ts";
import type { PromotionStore } from "#activities/promotion/store.ts";
import * as allocationPricing from "./ai-allocation-evidence.ts";

async function fixture() {
  const store = memoryPromotionStore();
  const row = { reservedUsd: 0, chargedUsd: null, model: "gpt-5.6-luna" };
  const runId = "01a1cfc4-47f8-7e93-8c27-c375610f23ec";
  const occurrenceId = `storm-promotion/discord-lfg-2-hour/${runId}`;
  const day = promotionSpendDay();
  const key = `ai/daily/${day}.json`;
  await store.put(key, { [occurrenceId]: row }, undefined);
  const saved = await store.read(key, PromotionAiLedgerSchema);
  if (saved === undefined) throw new Error("Fixture missing");
  const url = [
    "https://api.openai.com/v1/organization/usage/completions",
    "?start_time=1794487020&end_time=1794487200",
    "&bucket_width=1m&limit=3&models%5B%5D=gpt-5.6-luna",
    "&group_by%5B%5D=api_key_id&group_by%5B%5D=project_id",
    "&group_by%5B%5D=model&group_by%5B%5D=service_tier",
  ].join("");
  const request = PromotionAiAllocationRequestSchema.parse({
    version: 1,
    operation: "plan",
    targetId: "discord-lfg-2-hour",
    workflowId: "storm-promotion/discord-lfg-2-hour",
    runId,
    executionStartedAt: "2026-11-12T12:38:30.000Z",
    executionClosedAt: "2026-11-12T12:38:43.000Z",
    day,
    expectedLedgerEtag: saved.etag,
    expectedRowSha256: promotionAccountingHash(row),
    provider: {
      startAt: "2026-11-12T12:37:00Z",
      endAt: "2026-11-12T12:40:00Z",
      observedAt: "2026-11-12T12:47:13Z",
      querySha256: createHash("sha256").update(url).digest("hex"),
      responseSha256: "a".repeat(64),
      apiKeyId: "test-key-id",
      projectId: "test-project-id",
      model: row.model,
      hasMore: false,
      buckets: [
        {
          startTime: 1_794_487_020,
          endTime: 1_794_487_080,
          results: [
            {
              apiKeyId: "test-key-id",
              projectId: "test-project-id",
              model: row.model,
              serviceTier: "default",
              inputTokens: 160_894,
              cachedInputTokens: 138_275,
              outputTokens: 4155,
              numModelRequests: 9,
            },
          ],
        },
        {
          startTime: 1_794_487_080,
          endTime: 1_794_487_140,
          results: [
            {
              apiKeyId: "test-key-id",
              projectId: "test-project-id",
              model: row.model,
              serviceTier: "default",
              inputTokens: 175_822,
              cachedInputTokens: 141_418,
              outputTokens: 4057,
              numModelRequests: 11,
            },
          ],
        },
        { startTime: 1_794_487_140, endTime: 1_794_487_200, results: [] },
      ],
    },
    review: {
      operator: "fixture operator",
      reason:
        "Reviewed positive provider totals covering the entire closed execution; conservative full-window allocation.",
      copiedAuthoritativeResponse: true,
      coversWholeGeneration: true,
      relevantProviderIdentity: true,
      reportingCoverageAdequate: true,
      allocationIsNotExactBilledUsage: true,
    },
  });
  const inspectExecution = vi.fn(async () => ({
    workflowId: request.workflowId,
    type: "runStormPromotion",
    runId,
    startedAt: request.executionStartedAt,
    closedAt: request.executionClosedAt,
    status: "FAILED",
  }));
  const dependencies = { store, inspectExecution };
  const plan = await allocatePromotionAiWithEvidence(request, dependencies);
  return {
    store,
    row,
    key,
    occurrenceId,
    request: plan.reviewedRequest,
    dependencies,
  };
}

it("audits the full conservative aggregate once, retains exact uncertainty and accounts it consistently", async () => {
  const f = await fixture();
  const put = vi.spyOn(f.store, "put");
  const result = await allocatePromotionAiWithEvidence(
    f.request,
    f.dependencies,
  );
  expect(result.allocatedUsd).toBeCloseTo(0.04877852, 10);
  expect(result.exactUsage).toBe("unknown");
  expect(put.mock.calls.map(([key]) => key)).toEqual([
    `ai/allocations/${result.auditId}.json`,
    f.key,
  ]);
  const saved = await f.store.read(f.key, PromotionAiLedgerSchema);
  expect(saved?.value[f.occurrenceId]?.chargedUsd).toBeNull();
  expect(await readPromotionSpend(f.store)).toMatchObject({
    aiUsd: 0,
    allocatedAiUsd: result.allocatedUsd,
    unknownAi: 1,
    unallocatedUnknownAi: 0,
  });
  const status = await readProductionPromotionStatus(f.store);
  expect(status.overview.spend).toMatchObject({
    aiUsd: 0,
    allocatedAiUsd: result.allocatedUsd,
    unknownAi: 1,
    unallocatedUnknownAi: 0,
  });
  put.mockClear();
  const repeated = await allocatePromotionAiWithEvidence(
    f.request,
    f.dependencies,
  );
  expect(repeated.status).toBe("already-allocated");
  expect(put).not.toHaveBeenCalled();
  await expect(
    reservePromotionAi(f.store, "new", {
      model: "gpt-5.6-luna",
      dailySpendUsd: 0.04,
    }),
  ).rejects.toThrow("Daily promotion spend");
  const record = await reservePromotionAi(f.store, "new", {
    model: "gpt-5.6-luna",
    dailySpendUsd: 0.05,
  });
  await expect(
    reservePromotionAi(f.store, "blocked", {
      model: "gpt-5.6-luna",
      dailySpendUsd: 5,
    }),
  ).rejects.toThrow("usage is unknown");
  await record({
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    reasoningTokens: 0,
  });
});

it("native plan verifies the owner, ledger and catalog without writing, with the same apply intent", async () => {
  const f = await fixture();
  const put = vi.spyOn(f.store, "put");
  const plan = await allocatePromotionAiWithEvidence(
    {
      ...f.request,
      operation: "plan",
      expectedLedgerEtag: undefined,
      expectedRowSha256: undefined,
    },
    f.dependencies,
  );
  expect(plan.status).toBe("planned");
  expect(put).not.toHaveBeenCalled();
  expect(plan.reviewedRequest.expectedLedgerEtag).toBe(
    f.request.expectedLedgerEtag,
  );
  expect(plan.reviewedRequest.expectedRowSha256).toBe(
    f.request.expectedRowSha256,
  );
  const applied = await allocatePromotionAiWithEvidence(
    f.request,
    f.dependencies,
  );
  expect(applied.auditId).toBe(plan.auditId);
  expect(applied.allocatedUsd).toBe(plan.allocatedUsd);
});

it("reads a committed allocation from its immutable audit across later pricing changes", async () => {
  const f = await fixture();
  const applied = await allocatePromotionAiWithEvidence(
    f.request,
    f.dependencies,
  );
  const put = vi.spyOn(f.store, "put");
  const pricing = vi
    .spyOn(allocationPricing, "pricePromotionAiEvidence")
    .mockImplementation(() => {
      throw new Error("Later catalog changed or unavailable");
    });
  try {
    expect(
      await allocatePromotionAiWithEvidence(f.request, f.dependencies),
    ).toMatchObject({
      status: "already-allocated",
      allocatedUsd: applied.allocatedUsd,
      auditId: applied.auditId,
      catalogModelSha256: applied.catalogModelSha256,
    });
    await expect(
      allocatePromotionAiWithEvidence(
        {
          ...f.request,
          review: {
            ...f.request.review,
            reason:
              "Different independently supplied provider allocation decision",
          },
        },
        f.dependencies,
      ),
    ).rejects.toThrow("different or unaudited");
    expect(pricing).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    await expect(
      allocatePromotionAiWithEvidence(
        { ...f.request, expectedAuditId: "f".repeat(64) },
        f.dependencies,
      ),
    ).rejects.toThrow("different or unaudited");
  } finally {
    pricing.mockRestore();
  }
});

it("rejects changed catalog pricing between plan and first apply before any write", async () => {
  const f = await fixture();
  const originalPrice = allocationPricing.pricePromotionAiEvidence(f.request);
  const pricing = vi
    .spyOn(allocationPricing, "pricePromotionAiEvidence")
    .mockReturnValue({
      ...originalPrice,
      amountUsd: originalPrice.amountUsd + 1,
    });
  const put = vi.spyOn(f.store, "put");
  try {
    await expect(
      allocatePromotionAiWithEvidence(f.request, f.dependencies),
    ).rejects.toThrow("reviewed audit identity");
    expect(put).not.toHaveBeenCalled();
  } finally {
    pricing.mockRestore();
  }
});

it.each([
  "running",
  "type",
  "etag",
  "row",
  "identity",
  "window",
  "bucket",
  "empty",
  "digest",
  "model",
  "money",
])("refuses %s evidence before any write", async (fault) => {
  const f = await fixture();
  const request: unknown = structuredClone(f.request);
  const r = PromotionAiAllocationRequestSchema.parse(request);
  if (fault === "running")
    f.dependencies.inspectExecution.mockResolvedValue({
      ...(await f.dependencies.inspectExecution()),
      status: "RUNNING",
    });
  if (fault === "type")
    f.dependencies.inspectExecution.mockResolvedValue({
      ...(await f.dependencies.inspectExecution()),
      type: "otherWorkflow",
    });
  if (fault === "etag") r.expectedLedgerEtag = "stale";
  if (fault === "row") r.expectedRowSha256 = "b".repeat(64);
  if (fault === "identity")
    r.provider.buckets[0]!.results[0]!.apiKeyId = "another-key";
  if (fault === "window") r.executionStartedAt = "2026-11-12T12:36:59Z";
  if (fault === "bucket")
    r.provider.buckets[1]!.startTime = r.provider.buckets[0]!.startTime;
  if (fault === "empty")
    for (const bucket of r.provider.buckets) bucket.results = [];
  if (fault === "digest") r.provider.querySha256 = "f".repeat(64);
  const put = vi.spyOn(f.store, "put");
  await expect(
    allocatePromotionAiWithEvidence(
      fault === "money"
        ? { ...r, amountUsd: 0.001 }
        : fault === "model"
          ? { ...r, provider: { ...r.provider, model: "other" } }
          : r,
      f.dependencies,
    ),
  ).rejects.toThrow();
  expect(put).not.toHaveBeenCalled();
});

it("does not retry or overwrite a concurrent ledger change after its immutable audit", async () => {
  const f = await fixture();
  const original = f.store.put;
  const put = vi
    .spyOn(f.store, "put")
    .mockImplementation(async (key, value, etag) => {
      return key === f.key ? false : await original(key, value, etag);
    });
  await expect(
    allocatePromotionAiWithEvidence(f.request, f.dependencies),
  ).rejects.toThrow("no retry");
  expect(put.mock.calls.filter(([key]) => key === f.key)).toHaveLength(1);
  const readback = await f.store.read(f.key, PromotionAiLedgerSchema);
  expect(readback?.value[f.occurrenceId]).toEqual(f.row);
});

it("requires reviewed historical evidence for a legacy row instead of using current model configuration", async () => {
  const f = await fixture();
  await f.store.put(
    f.key,
    { [f.occurrenceId]: { reservedUsd: 0, chargedUsd: null } },
    f.request.expectedLedgerEtag,
  );
  const plan = {
    ...f.request,
    operation: "plan",
    expectedLedgerEtag: undefined,
    expectedRowSha256: undefined,
  };
  await expect(
    allocatePromotionAiWithEvidence(plan, f.dependencies),
  ).rejects.toThrow("recorded execution model");
  const result = await allocatePromotionAiWithEvidence(
    {
      ...plan,
      review: {
        ...plan.review,
        historicalModel: {
          model: "gpt-5.6-luna",
          evidenceSha256: "b".repeat(64),
          evidenceReference:
            "Reviewed immutable pre-interruption settings snapshot",
        },
      },
    },
    f.dependencies,
  );
  expect(result.status).toBe("planned");
  expect(result.allocatedUsd).toBeCloseTo(0.04877852, 10);
});

it("refuses an unavailable/conflicting immutable audit before touching the ledger", async () => {
  const f = await fixture();
  const put = vi.spyOn(f.store, "put").mockResolvedValue(false);
  await expect(
    allocatePromotionAiWithEvidence(f.request, f.dependencies),
  ).rejects.toThrow("Immutable allocation audit conflicts");
  expect(put).toHaveBeenCalledOnce();
  expect(put.mock.calls[0]?.[0]).toMatch(/^ai\/allocations\//);
});

it("fails an unequal readback after the single conditional write without silently retrying", async () => {
  const f = await fixture();
  let ledgerWritten = false;
  const store: PromotionStore = {
    put: async (key, value, etag) => {
      const result = await f.store.put(key, value, etag);
      if (result && key === f.key) ledgerWritten = true;
      return result;
    },
    read: async (key, schema) => {
      const current = await f.store.read(key, schema);
      return ledgerWritten && current !== undefined && key === f.key
        ? { etag: current.etag, value: schema.parse({}) }
        : current;
    },
  };
  await expect(
    allocatePromotionAiWithEvidence(f.request, { ...f.dependencies, store }),
  ).rejects.toThrow("readback differs");
});
