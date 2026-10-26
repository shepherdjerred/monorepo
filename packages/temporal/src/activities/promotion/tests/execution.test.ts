import { MockActivityEnvironment } from "@temporalio/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promotionConfig } from "#config/promotion.ts";
import type * as StoreModule from "#activities/promotion/store.ts";
import { promotionPrompt } from "#activities/promotion/prompt.ts";
import { promotionTarget } from "#activities/promotion/manifest.ts";
import {
  promotionAgentActivities,
  promotionControlActivities,
} from "#activities/promotion/index.ts";
import { runPromotionAgent } from "#activities/promotion/agent.ts";
import { memoryPromotionStore } from "#activities/promotion/test-support.ts";
import {
  promotionStore,
  readPromotionState,
  updatePromotionState,
} from "#activities/promotion/store.ts";

vi.mock("#config/promotion.ts", () => ({ promotionConfig: vi.fn() }));
vi.mock("#activities/promotion/agent.ts", () => ({
  runPromotionAgent: vi.fn(),
}));
vi.mock("#activities/promotion/store.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof StoreModule>()),
  promotionStore: vi.fn(),
}));

function environment(workflowId = "storm-promotion/pmc") {
  return new MockActivityEnvironment({
    workflowExecution: { workflowId, runId: "fixture-run" },
  });
}

async function execute(
  mode: Parameters<typeof promotionAgentActivities.executePromotion>[0]["mode"],
  workflowId?: string,
) {
  const activity = promotionAgentActivities.executePromotion;
  return await environment(workflowId).run<
    Parameters<typeof activity>,
    Awaited<ReturnType<typeof activity>>,
    typeof activity
  >(activity, { targetId: "pmc", mode });
}

async function inspect() {
  const activity = promotionControlActivities.inspectPromotionTick;
  return await environment().run<
    Parameters<typeof activity>,
    Awaited<ReturnType<typeof activity>>,
    typeof activity
  >(activity);
}

async function seedLargeHistory() {
  const text = `baseline-only-${"x".repeat(120_000)}`;
  return await updatePromotionState(promotionStore(), "pmc", (state) => ({
    ...state,
    attempts: Array.from({ length: 60 }, (_, index) => ({
      occurrenceId: `storm-promotion/pmc/run-${String(index)}`,
      attemptedAt: "2026-10-25T12:00:00.000Z",
      settledAt: "2026-10-25T12:00:01.000Z",
      status: "verified" as const,
      contentHash: "fixture",
      receiptUrl: promotionTarget("pmc").url,
      evidenceKey: "private/receipt.png",
      beforeSubmission: [
        {
          id: crypto.randomUUID(),
          url: promotionTarget("pmc").url,
          capturedAt: "2026-10-25T12:00:00.000Z",
          text,
        },
      ],
    })),
  }));
}

describe("promotion execution boundaries", () => {
  beforeEach(() => {
    vi.stubEnv("TEMPORAL_NAMESPACE", "prod");
    vi.mocked(promotionStore).mockReturnValue(memoryPromotionStore());
    vi.mocked(promotionConfig).mockResolvedValue({
      enabled: true,
      enabledTargets: ["pmc"],
      model: "fixture",
      maxSteps: 1,
      timeoutMinutes: 1,
      monthlySolverUsd: 0,
    });
    vi.mocked(runPromotionAgent).mockReset();
    vi.mocked(runPromotionAgent).mockResolvedValue({
      result: { status: "deferred", summary: "Site requests waiting" },
      usage: {
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      },
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["status", "pause", "resume"] as const)(
    "keeps %s results bounded without discarding stored receipt baselines",
    async (operation) => {
      await seedLargeHistory();
      const activity = promotionControlActivities.managePromotion;
      const result = await environment().run<
        Parameters<typeof activity>,
        Awaited<ReturnType<typeof activity>>,
        typeof activity
      >(activity, { operation, targetId: "pmc" });
      const encoded = JSON.stringify(result);
      expect(encoded.length).toBeLessThan(100_000);
      expect(encoded).not.toContain("baseline-only");
      expect(result[0]?.attemptCount).toBe(60);
      expect(result[0]?.attempts).toHaveLength(50);
      expect(result[0]?.attempts[0]?.evidenceKey).toBe("private/receipt.png");
      expect(result[0]?.paused).toBe(operation === "pause");
      const stored = await readPromotionState(promotionStore(), "pmc");
      expect(stored.attempts).toHaveLength(60);
      expect(
        stored.attempts[0]?.beforeSubmission[0]?.text.length,
      ).toBeGreaterThan(120_000);
    },
  );

  it("omits historical page bodies from the next agent's prompt", async () => {
    const state = await seedLargeHistory();
    const prompt = promotionPrompt({
      target: promotionTarget("pmc"),
      state,
      content: "Approved fixture copy",
      mode: "run",
    });
    expect(prompt.length).toBeLessThan(100_000);
    expect(prompt).not.toContain("baseline-only");
    expect(prompt).toContain("run-59");
    expect(prompt).not.toContain('"storm-promotion/pmc/run-0"');
  });

  it("rejects a foreign Workflow identity before acquiring a target claim", async () => {
    await expect(execute("reconcile", "manual/foreign")).rejects.toThrow(
      "Workflow ID",
    );
    const state = await readPromotionState(promotionStore(), "pmc");
    expect(state.lock).toBeNull();
    expect(state.lastOccurrenceId).toBeNull();
    expect(runPromotionAgent).not.toHaveBeenCalled();
  });

  it.each([null, "2026-01-01T00:00:00.000Z"])(
    "blocks a deferral without a future eligibility deadline (%s)",
    async (nextEligibleAt) => {
      await updatePromotionState(promotionStore(), "pmc", (state) => ({
        ...state,
        nextEligibleAt,
      }));
      const result = await execute("run");
      expect(result.status).toBe("blocked");
      expect(result.summary).toContain("future eligibility deadline");
      const tick = await inspect();
      expect(tick.dueTargetIds).not.toContain("pmc");
      expect(tick.alerts.some((alert) => alert.targetId === "pmc")).toBe(true);
    },
  );

  it("preserves an evidence-backed future deferral", async () => {
    const nextEligibleAt = new Date(Date.now() + 3_600_000).toISOString();
    await updatePromotionState(promotionStore(), "pmc", (state) => ({
      ...state,
      nextEligibleAt,
    }));
    const result = await execute("run");
    expect(result.status).toBe("deferred");
    const state = await readPromotionState(promotionStore(), "pmc");
    expect(state.nextEligibleAt).toBe(nextEligibleAt);
    expect(state.blockedReason).toBeNull();
    expect(state.lock).toBeNull();
  });
});
