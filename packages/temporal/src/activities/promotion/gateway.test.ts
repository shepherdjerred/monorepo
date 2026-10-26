import { describe, expect, it, vi } from "vitest";
import { PromotionGateway } from "./gateway.ts";
import { memoryPromotionStore } from "./test-support.ts";
import { readPromotionState, updatePromotionState } from "./store.ts";
import { promotionTarget } from "./manifest.ts";
import type { PromotionPreflight } from "#shared/promotion.ts";

async function harness(preview = false) {
  const store = memoryPromotionStore();
  const target = promotionTarget("pmc");
  const now = Date.parse("2026-10-25T12:00:00.000Z");
  await updatePromotionState(store, target.id, (state) => ({
    ...state,
    checkedAt: "2026-10-25T10:00:00.000Z",
    lock: { occurrenceId: "run-1", acquiredAt: new Date(now).toISOString() },
  }));
  const submit = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const enabled = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
  const gateway = new PromotionGateway({
    store,
    target,
    occurrenceId: "run-1",
    preview,
    now: () => now,
    enabled,
    submit,
    capture: () =>
      Promise.resolve({
        url: target.url,
        text: "Server bumped successfully",
        screenshotKey: "private/evidence.png",
      }),
  });
  const evidence = gateway.observe(
    target.rulesUrl,
    "Bump once every 24 hours. No previous bumps recorded.",
  );
  const preflight: PromotionPreflight = {
    policy: { kind: "rolling", windowSeconds: 86_400, maxActions: 1 },
    ruleObservationId: evidence.id,
    ruleQuote: "Bump once every 24 hours.",
    historyObservationIds: [evidence.id],
    historyComplete: true,
    previousActions: [],
    nextAllowedAt: null,
    equivalentPostExists: false,
    substantiveNewsAvailable: false,
    explanation: "Confirmed rules and complete current history.",
  };
  gateway.observe(target.url, "The Storm server listing. Bump this server.");
  return { store, target, submit, enabled, gateway, preflight };
}

describe("promotion publishing gateway", () => {
  it("records intent before the external click and only accepts a real readback", async () => {
    const test = await harness();
    test.submit.mockImplementation(async () => {
      const state = await readPromotionState(test.store, "pmc");
      expect(state.attempts[0]?.status).toBe("uncertain");
    });
    await test.gateway.preflight(test.preflight);
    await test.gateway.publish("#bump", "Native bump");
    await expect(
      test.gateway.verify({
        status: "verified",
        receiptUrl: test.target.url,
        quote: "invented confirmation",
      }),
    ).rejects.toThrow("readback");
    await test.gateway.verify({
      status: "verified",
      receiptUrl: test.target.url,
      quote: "Server bumped successfully",
    });
    const verified = await readPromotionState(test.store, "pmc");
    expect(verified.attempts[0]?.status).toBe("verified");
    await expect(test.gateway.publish("#bump", "Native bump")).rejects.toThrow(
      "already attempted",
    );
    expect(test.submit).toHaveBeenCalledTimes(1);
  });
  it("keeps a timed-out submission uncertain and refuses another attempt", async () => {
    const test = await harness();
    await test.gateway.preflight(test.preflight);
    test.submit.mockRejectedValue(
      new Error("connection timed out after submit"),
    );
    await expect(test.gateway.publish("#bump", "Bump")).rejects.toThrow(
      "timed out",
    );
    const uncertain = await readPromotionState(test.store, "pmc");
    expect(uncertain.attempts[0]?.status).toBe("uncertain");
    await expect(test.gateway.publish("#bump", "Bump")).rejects.toThrow(
      "already attempted",
    );
  });
  it("retains the original receipt baseline when a different run reconciles an uncertain bump", async () => {
    const test = await harness();
    test.gateway.observe(test.target.url, "Server bumped successfully");
    await test.gateway.preflight(test.preflight);
    await test.gateway.publish("#bump", "Native bump");
    const original = await readPromotionState(test.store, test.target.id);
    expect(original.attempts[0]?.beforeSubmission).toContainEqual(
      expect.objectContaining({ text: "Server bumped successfully" }),
    );
    await updatePromotionState(test.store, test.target.id, (state) => ({
      ...state,
      lock: { occurrenceId: "run-2", acquiredAt: "2026-10-25T12:01:00.000Z" },
    }));
    let text = "Server bumped successfully";
    const reconcile = new PromotionGateway({
      store: test.store,
      target: test.target,
      occurrenceId: "run-2",
      preview: false,
      enabled: test.enabled,
      now: () => Date.parse("2026-10-25T12:01:00.000Z"),
      submit: test.submit,
      capture: () =>
        Promise.resolve({
          url: test.target.url,
          text,
          screenshotKey: "private/reconcile.png",
        }),
    });
    const receipt = {
      status: "verified" as const,
      receiptUrl: test.target.url,
      quote: text,
      occurrenceId: "run-1",
    };
    await expect(reconcile.verify(receipt)).rejects.toThrow("already present");
    const uncertain = await readPromotionState(test.store, test.target.id);
    expect(uncertain.attempts[0]?.status).toBe("uncertain");
    text = "Server bumped at 12:01 successfully";
    await reconcile.verify({ ...receipt, quote: text });
    const verified = await readPromotionState(test.store, test.target.id);
    expect(verified.attempts[0]?.status).toBe("verified");
    expect(test.submit).toHaveBeenCalledTimes(1);
  });
  it("rechecks a pause and the fresh enable flag immediately before publication", async () => {
    const test = await harness();
    await test.gateway.preflight(test.preflight);
    await updatePromotionState(test.store, "pmc", (state) => ({
      ...state,
      paused: true,
    }));
    await expect(test.gateway.publish("#bump", "Bump")).rejects.toThrow(
      "paused",
    );
    test.enabled.mockResolvedValue(false);
    await expect(test.gateway.publish("#bump", "Bump")).rejects.toThrow(
      "disabled",
    );
    expect(test.submit).not.toHaveBeenCalled();
  });
  it("enforces preview and occurrence ownership outside the prompt", async () => {
    const test = await harness(true);
    await test.gateway.preflight(test.preflight);
    await expect(test.gateway.publish("#bump", "Bump")).rejects.toThrow(
      "Preview",
    );
    await updatePromotionState(test.store, "pmc", (state) => ({
      ...state,
      lock: { occurrenceId: "another", acquiredAt: "2026-10-25T12:00:00.000Z" },
    }));
    await expect(test.gateway.preflight(test.preflight)).rejects.toThrow(
      "no longer owns",
    );
  });
});
