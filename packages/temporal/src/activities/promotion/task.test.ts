import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { promotionTarget } from "./manifest.ts";
import { memoryPromotionStore } from "./test-support.ts";
import { readPromotionState, updatePromotionState } from "./store.ts";
import { PromotionTaskJournal } from "./task.ts";
import {
  PromotionTaskResultSchema,
  PromotionPreviewResultSchema,
  type PromotionTaskResult,
} from "./task-contract.ts";

const now = Date.parse("2026-10-26T12:00:00.000Z");
const result: PromotionTaskResult = {
  status: "preview",
  summary: "Prepared the assigned native action",
  performedAction: false,
  nextEligibleAt: null,
  preparedContent: "Native owner refresh",
  evidence: [],
  receipt: null,
};
async function harness(mode: "preview" | "run" | "reconcile" = "run") {
  const store = memoryPromotionStore(),
    target = promotionTarget("pmc");
  await updatePromotionState(store, target.id, (state) => ({
    ...state,
    lock: { occurrenceId: "fixture", acquiredAt: new Date(now).toISOString() },
  }));
  const enabled = vi.fn().mockResolvedValue(true);
  const capture = vi.fn().mockResolvedValue({
    url: target.url,
    text: "The new owner refresh is complete",
    screenshotKey: "evidence/receipt.png",
  });
  const journal = new PromotionTaskJournal({
    target,
    store,
    occurrenceId: "fixture",
    mode,
    enabled,
    now: () => now,
    capture,
  });
  journal.observe({
    url: target.url,
    text: "Existing placement and its rules",
  });
  return {
    store,
    target,
    enabled,
    capture,
    journal,
    state: () => readPromotionState(store, target.id),
  };
}

describe("inspection deadline preservation", () => {
  it.each([null, "2026-10-25T12:00:00.000Z", "2026-10-26T13:00:00.000Z"])(
    "does not shorten the caller's saved deadline after an inspection (%s)",
    async (nextEligibleAt) => {
      const test = await harness("preview");
      const saved = "2026-10-27T12:00:00.000Z";
      await updatePromotionState(test.store, test.target.id, (state) => ({
        ...state,
        nextEligibleAt: saved,
      }));
      await test.journal.finish({
        ...result,
        status: "blocked",
        nextEligibleAt,
      });
      const state = await test.state();
      expect(state.nextEligibleAt).toBe(saved);
      expect(test.capture).not.toHaveBeenCalled();
    },
  );
});

describe("task-driven promotion journal", () => {
  it("checkpoints a possible effect before browser I/O and retains it after ambiguity", async () => {
    const test = await harness();
    await test.journal.beforeMutation();
    await test.journal.beforeMutation();
    const state = await test.state();
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0]).toMatchObject({
      status: "uncertain",
      beforeSubmission: [{ text: "Existing placement and its rules" }],
    });
    await test.journal.finish({
      ...result,
      status: "blocked",
      performedAction: true,
    });
    const final = await test.state();
    expect(final.attempts[0]?.status).toBe("uncertain");
  });
  it("records non-publication interactions separately from posts", async () => {
    const test = await harness();
    await test.journal.beforeMutation();
    await test.journal.finish({
      ...result,
      status: "blocked",
      summary: "Inspected menu; history was incomplete",
    });
    const final = await test.state();
    expect(final.attempts[0]).toMatchObject({
      status: "no-action",
      receiptUrl: null,
    });
  });
  it("retains an ambiguous browser write even when the agent reports no action", async () => {
    const test = await harness();
    await test.journal.beforeMutation();
    test.journal.mutationFailed();
    await expect(test.journal.beforeMutation()).rejects.toThrow("uncertain");
    await test.journal.finish({
      ...result,
      status: "blocked",
      performedAction: false,
    });
    const final = await test.state();
    expect(final.attempts[0]?.status).toBe("uncertain");
  });
  it("preserves the original baseline when later interactions expose the receipt", async () => {
    const test = await harness();
    await test.journal.beforeMutation();
    test.journal.observe({
      url: test.target.url,
      text: "The new owner refresh is complete",
    });
    await test.journal.beforeMutation();
    await test.journal.finish({
      ...result,
      status: "verified",
      performedAction: true,
      nextEligibleAt: "2026-10-27T12:00:00.000Z",
      receipt: {
        status: "verified",
        url: test.target.url,
        quote: "The new owner refresh is complete",
        occurrenceId: null,
      },
    });
    const state = await test.state();
    expect(state.attempts[0]?.beforeSubmission).toHaveLength(1);
    expect(state.attempts[0]?.status).toBe("verified");
  });
});

describe("preview evidence provenance", () => {
  it("requires positive preview quotes to come from live observations on the cited page", async () => {
    const test = await harness("preview");
    await expect(test.journal.finish(result)).rejects.toThrow(
      "captured live evidence",
    );
    await expect(
      test.journal.finish({
        ...result,
        evidence: [
          { url: test.target.url, quote: "A historical bump deadline" },
        ],
      }),
    ).rejects.toThrow("absent from live browser evidence");
    await expect(
      test.journal.finish({
        ...result,
        evidence: [
          {
            url: test.target.rulesUrl,
            quote: "Existing placement and its rules",
          },
        ],
      }),
    ).rejects.toThrow("absent from live browser evidence");
    await test.journal.finish({
      ...result,
      evidence: [
        { url: test.target.url, quote: "Existing placement and its rules" },
      ],
    });
    const state = await test.state();
    expect(state.attempts).toEqual([]);
  });
  it("accepts exact quotes escaped by native JSON observations", async () => {
    const test = await harness("preview");
    test.journal.observe({
      url: test.target.url,
      text: JSON.stringify({
        snapshot: { nodes: [{ name: 'Owner says "Ready"\nToday' }] },
      }),
    });
    await test.journal.finish({
      ...result,
      evidence: [{ url: test.target.url, quote: 'Owner says "Ready"\nToday' }],
    });
  });
  it("constrains the provider's preview schema to results without effects", () => {
    expect(PromotionPreviewResultSchema.safeParse(result).success).toBe(true);
    expect(
      PromotionPreviewResultSchema.safeParse({ ...result, status: "verified" })
        .success,
    ).toBe(false);
    expect(
      PromotionPreviewResultSchema.safeParse({
        ...result,
        performedAction: true,
      }).success,
    ).toBe(false);
  });
});

describe("promotion ownership and settlement", () => {
  it("refuses to replay the same occurrence after its executor was replaced", async () => {
    const test = await harness();
    await test.journal.beforeMutation();
    const replacement = new PromotionTaskJournal({
      target: test.target,
      store: test.store,
      occurrenceId: "fixture",
      mode: "run",
      enabled: test.enabled,
      now: () => now,
      capture: test.capture,
    });
    await expect(replacement.beforeMutation()).rejects.toThrow(
      "already has an effect checkpoint",
    );
  });
  it("requires actual new remote confirmation before settling an action", async () => {
    const test = await harness();
    await test.journal.beforeMutation();
    const receipt = {
      status: "verified" as const,
      url: test.target.url,
      quote: "The new owner refresh is complete",
      occurrenceId: null,
    };
    await test.journal.finish({
      ...result,
      status: "verified",
      performedAction: true,
      receipt,
      nextEligibleAt: "2026-10-27T12:00:00.000Z",
    });
    expect(test.capture).toHaveBeenCalledOnce();
    const state = await test.state();
    expect(state.attempts[0]).toMatchObject({
      status: "verified",
      evidenceKey: "evidence/receipt.png",
    });
    expect(Date.parse(state.nextEligibleAt ?? "")).toBeGreaterThan(
      Date.parse("2026-10-27T12:00:00.000Z"),
    );
  });
  it.each([null, "2026-10-25T12:00:00.000Z"])(
    "settles a verified action without a future deadline (%s)",
    async (nextEligibleAt) => {
      const test = await harness();
      await test.journal.beforeMutation();
      await test.journal.finish({
        ...result,
        status: "verified",
        performedAction: true,
        nextEligibleAt,
        receipt: {
          status: "verified",
          url: test.target.url,
          quote: "The new owner refresh is complete",
          occurrenceId: null,
        },
      });
      const state = await test.state();
      expect(state.attempts[0]?.status).toBe("verified");
      expect(
        state.nextEligibleAt === null || Date.parse(state.nextEligibleAt) < now,
      ).toBe(true);
    },
  );
  it("refuses a confirmation which existed before the browser interaction", async () => {
    const test = await harness();
    test.journal.observe({
      url: test.target.url,
      text: "The new owner refresh is complete",
    });
    await test.journal.beforeMutation();
    await expect(
      test.journal.finish({
        ...result,
        status: "verified",
        performedAction: true,
        receipt: {
          status: "verified",
          url: test.target.url,
          quote: "The new owner refresh is complete",
          occurrenceId: null,
        },
      }),
    ).rejects.toThrow("already present");
    const final = await test.state();
    expect(final.attempts[0]?.status).toBe("uncertain");
  });
  it.each(["preview", "reconcile"] as const)(
    "blocks browser writes in %s outside the prompt",
    async (mode) => {
      const test = await harness(mode);
      await expect(test.journal.beforeMutation()).rejects.toThrow("Read-only");
      const final = await test.state();
      expect(final.attempts).toEqual([]);
    },
  );
  it("checks publishing configuration again on each browser mutation", async () => {
    const test = await harness();
    await test.journal.beforeMutation();
    test.enabled.mockResolvedValue(false);
    await expect(test.journal.beforeMutation()).rejects.toThrow("disabled");
  });
  it("retains a prior uncertain effect instead of dispatching another", async () => {
    const test = await harness();
    await test.journal.beforeMutation();
    await updatePromotionState(test.store, test.target.id, (state) => ({
      ...state,
      attempts: state.attempts.map((item) => ({
        ...item,
        occurrenceId: "prior",
      })),
    }));
    await expect(test.journal.beforeMutation()).rejects.toThrow(
      "reconciliation",
    );
  });
  it("enforces the stored cooldown without interpreting website wording", async () => {
    const test = await harness();
    await updatePromotionState(test.store, test.target.id, (state) => ({
      ...state,
      nextEligibleAt: "2026-10-27T12:00:00.000Z",
    }));
    await expect(test.journal.beforeMutation()).rejects.toThrow("cooldown");
  });
  it("keeps preview receipts and deadline claims honest", async () => {
    const test = await harness("preview");
    await expect(
      test.journal.finish({ ...result, performedAction: true }),
    ).rejects.toThrow("Preview");
    await expect(
      test.journal.finish({ ...result, status: "deferred" }),
    ).rejects.toThrow("future deadline");
    expect(test.capture).not.toHaveBeenCalled();
  });
  it("validates URLs at runtime while exporting a provider-compatible schema", () => {
    expect(
      PromotionTaskResultSchema.safeParse({
        ...result,
        evidence: [{ url: "invalid", quote: "rule" }],
      }).success,
    ).toBe(false);
    expect(
      JSON.stringify(z.toJSONSchema(PromotionTaskResultSchema)),
    ).not.toContain('"format":"uri"');
  });
});
