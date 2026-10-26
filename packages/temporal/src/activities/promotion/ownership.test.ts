import { describe, expect, it, vi } from "vitest";
import { WorkflowNotFoundError } from "@temporalio/client";
import { reconcileClosedPromotionOwner } from "./ownership.ts";
import { memoryPromotionStore } from "./test-support.ts";
import { readPromotionState, updatePromotionState } from "./store.ts";

describe("promotion owner recovery", () => {
  it("retains an expired owner's claim without failing unrelated dispatch", async () => {
    const store = memoryPromotionStore();
    const state = await updatePromotionState(store, "pmc", (value) => ({
      ...value,
      lock: {
        occurrenceId: "storm-promotion/pmc/expired",
        acquiredAt: "2026-01-01T00:00:00.000Z",
      },
      attempts: [
        {
          occurrenceId: "storm-promotion/pmc/expired",
          attemptedAt: "2026-01-01T00:00:00.000Z",
          settledAt: null,
          status: "uncertain",
          contentHash: "fixture",
          receiptUrl: null,
          evidenceKey: null,
        },
      ],
    }));
    const result = await reconcileClosedPromotionOwner({
      store,
      state,
      ownerRunning: (id, run) =>
        Promise.reject(new WorkflowNotFoundError("Retention expired", id, run)),
    });
    expect(result.lock).toEqual(state.lock);
    expect(result.attempts[0]?.status).toBe("uncertain");
    expect(result.blockedReason).toContain("history is unavailable");
    await expect(
      reconcileClosedPromotionOwner({
        store,
        state,
        ownerRunning: () => Promise.reject(new Error("Connection unavailable")),
      }),
    ).rejects.toThrow("Connection unavailable");
  });
  it("leaves a quiet running owner alone and retains uncertain effects after closure", async () => {
    const store = memoryPromotionStore();
    const state = await updatePromotionState(store, "pmc", (value) => ({
      ...value,
      lock: {
        occurrenceId: "storm-promotion/pmc/run-1",
        acquiredAt: "2026-10-25T00:00:00.000Z",
      },
      attempts: [
        {
          occurrenceId: "storm-promotion/pmc/run-1",
          attemptedAt: "2026-10-25T00:00:00.000Z",
          settledAt: null,
          status: "uncertain",
          contentHash: "fixture",
          receiptUrl: null,
          evidenceKey: null,
        },
      ],
    }));
    const ownerRunning = vi
      .fn<(workflowId: string, runId: string) => Promise<boolean>>()
      .mockResolvedValue(true);
    expect(
      await reconcileClosedPromotionOwner({ store, state, ownerRunning }),
    ).toEqual(state);
    ownerRunning.mockResolvedValue(false);
    const recovered = await reconcileClosedPromotionOwner({
      store,
      state,
      ownerRunning,
    });
    expect(recovered.lock).toEqual(state.lock);
    expect(recovered.blockedReason).toContain("uncertain submission");
  });
  it("releases a proven closed owner only when no publish intent exists", async () => {
    const store = memoryPromotionStore();
    const state = await updatePromotionState(store, "pmc", (value) => ({
      ...value,
      lock: {
        occurrenceId: "storm-promotion/pmc/run-1",
        acquiredAt: "2026-10-25T00:00:00.000Z",
      },
    }));
    await reconcileClosedPromotionOwner({
      store,
      state,
      ownerRunning: () => Promise.resolve(false),
    });
    const recovered = await readPromotionState(store, "pmc");
    expect(recovered.lock).toBeNull();
  });
});
