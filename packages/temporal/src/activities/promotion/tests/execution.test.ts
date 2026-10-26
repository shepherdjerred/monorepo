import { MockActivityEnvironment } from "@temporalio/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promotionConfig } from "#config/promotion.ts";
import type * as StoreModule from "#activities/promotion/store.ts";
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
