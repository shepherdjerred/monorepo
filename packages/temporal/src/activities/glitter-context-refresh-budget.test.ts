import { describe, expect, test } from "vitest";
import { MAX_SEMANTIC_ATTEMPTS } from "@shepherdjerred/llm-runtime";
import { ApplicationFailure } from "@temporalio/common";
import {
  estimatedCallCostUsd,
  GenerationBudget,
  inputTokenUpperBound,
  worstCaseGenerationCostUsd,
} from "./glitter-context-refresh-budget.ts";
import {
  SYNTHESIS_MAX_OUTPUT_TOKENS,
  SYNTHESIS_MODEL,
  SYNTHESIS_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS,
} from "./glitter-context-refresh-style-generation-cost.ts";
import { SYNTHESIS_INPUT_BYTE_LIMIT } from "./glitter-context-refresh-synthesis-limit.ts";
import { estimateRelationshipGenerationCost } from "./glitter-context-refresh-generate.ts";
import {
  buildBoundedRelationshipInput,
  RELATIONSHIP_INPUT_BYTE_LIMIT,
  RELATIONSHIP_MAX_OUTPUT_TOKENS,
  RELATIONSHIP_MODEL,
} from "./glitter-context-refresh-requests.ts";
import { CurrentMessageSchema } from "#shared/glitter-corpus.ts";

describe("Glitter generation budget", () => {
  test("reserves every semantic attempt a single generation may bill", () => {
    const singleAttempt = estimatedCallCostUsd({
      model: "gpt-5.6-luna",
      inputTokenUpperBound: 10_000,
      outputTokenUpperBound: 2000,
    });
    const worstCase = worstCaseGenerationCostUsd({
      model: "gpt-5.6-luna",
      inputTokenUpperBound: 10_000,
      outputTokenUpperBound: 2000,
    });

    expect(MAX_SEMANTIC_ATTEMPTS).toBeGreaterThan(1);
    // Each retry also carries the corrective preamble, so the reservation is
    // strictly more than the naive per-attempt multiple.
    expect(worstCase).toBeGreaterThan(singleAttempt * MAX_SEMANTIC_ATTEMPTS);
  });

  test("prices semantic retries at the raised truncation ceiling", () => {
    const flat = worstCaseGenerationCostUsd({
      model: "gpt-5.6-sol",
      inputTokenUpperBound: 50_000,
      outputTokenUpperBound: 28_000,
    });
    const raised = worstCaseGenerationCostUsd({
      model: "gpt-5.6-sol",
      inputTokenUpperBound: 50_000,
      outputTokenUpperBound: 28_000,
      semanticRetryOutputTokenUpperBound: 40_000,
    });

    expect(raised).toBeGreaterThan(flat);
  });
});

describe("Glitter capped requests", () => {
  test("admits a bounded synthesis reservation under the weekly cap", () => {
    const reservation = worstCaseGenerationCostUsd({
      model: SYNTHESIS_MODEL,
      inputTokenUpperBound: SYNTHESIS_INPUT_BYTE_LIMIT,
      outputTokenUpperBound: SYNTHESIS_MAX_OUTPUT_TOKENS,
      semanticRetryOutputTokenUpperBound:
        SYNTHESIS_TRUNCATION_RETRY_MAX_OUTPUT_TOKENS,
    });
    const weeklyBudget = new GenerationBudget(1);

    expect(SYNTHESIS_MODEL).toBe("gpt-5.6-luna");
    expect(() => {
      weeklyBudget.authorizeUncachedCall(reservation);
    }).not.toThrow();
  });

  test("admits a normal relationship reservation under the weekly cap", () => {
    const reservation = worstCaseGenerationCostUsd({
      model: RELATIONSHIP_MODEL,
      // Conservatively covers the serialized 500-message evidence window
      // while staying below Luna's context limit at ordinary message sizes.
      inputTokenUpperBound: 250_000,
      outputTokenUpperBound: RELATIONSHIP_MAX_OUTPUT_TOKENS,
    });
    const weeklyBudget = new GenerationBudget(1);

    expect(RELATIONSHIP_MODEL).toBe("gpt-5.6-luna");
    expect(() => {
      weeklyBudget.authorizeUncachedCall(reservation);
    }).not.toThrow();
  });

  test("bounds max-length multibyte relationship evidence under the weekly cap", () => {
    const evidence = Array.from({ length: 500 }, (_, index) => ({
      personId: index % 2 === 0 ? "caitlyn" : "richard",
      message: CurrentMessageSchema.parse({
        schemaVersion: 1,
        source: "discord-rest",
        guildId: "12345678901234567",
        guildSlug: "glitter-boys",
        channelId: "22345678901234567",
        messageId: String(60_000_000_000_000_000n + BigInt(index)),
        author: {
          id: "32345678901234567",
          username: "person",
          globalName: "Person",
          discriminator: "0",
          bot: false,
          avatar: null,
        },
        content: "界".repeat(500),
        timestamp: "2026-07-01T00:00:00.000Z",
        editedTimestamp: null,
        type: 0,
        flags: "0",
        pinned: false,
        tts: false,
        attachments: [],
        referencedMessageId: null,
        selectedObservationKey: `observation-${String(index)}`,
        selectedObservedAt: "2026-07-01T00:00:01.000Z",
        rawSha256: index.toString(16).padStart(64, "0"),
      }),
    }));
    const input = {
      people: [
        { id: "caitlyn", displayName: "Caitlyn" },
        { id: "richard", displayName: "Richard" },
      ],
      currentRelationships: [],
      evidence,
    };
    const bounded = buildBoundedRelationshipInput(input);
    const weeklyBudget = new GenerationBudget(1);

    expect(bounded.inputBytes).toBeLessThanOrEqual(
      RELATIONSHIP_INPUT_BYTE_LIMIT,
    );
    expect(bounded.evidence.length).toBeLessThan(evidence.length);
    expect(bounded.evidence[0]).toEqual(evidence[0]);
    expect(() => {
      weeklyBudget.authorizeUncachedCall(
        estimateRelationshipGenerationCost(input),
      );
    }).not.toThrow();
  });
});

describe("Glitter generation budget accounting", () => {
  test("a run that exhausts its semantic retries stays inside the reservation", () => {
    const reserved = worstCaseGenerationCostUsd({
      model: "gpt-5.6-luna",
      inputTokenUpperBound: 10_000,
      outputTokenUpperBound: 2000,
    });
    const budget = new GenerationBudget(reserved);
    budget.authorizeUncachedCall(reserved);

    // The billed cost of all three attempts is what `record` later observes.
    const billedPerAttempt = reserved / MAX_SEMANTIC_ATTEMPTS;
    for (let attempt = 0; attempt < MAX_SEMANTIC_ATTEMPTS; attempt += 1) {
      budget.record({
        response: { value: "attempt" },
        key: `artifact-${String(attempt)}`,
        requestSha256: String(attempt).repeat(64),
        cacheStatus: "miss",
        billedToCurrentRun: true,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          costUsd: billedPerAttempt,
        },
      });
    }

    expect(budget.summary().actualUncachedCostUsd).toBeLessThanOrEqual(
      reserved,
    );
  });

  test("uses a byte-based input upper bound and rejects unaffordable misses", () => {
    const callCost = estimatedCallCostUsd({
      model: "gpt-5.6-luna",
      inputTokenUpperBound: inputTokenUpperBound("hello"),
      outputTokenUpperBound: 1000,
    });
    const budget = new GenerationBudget(callCost / 2);

    let failure: unknown;
    try {
      budget.authorizeUncachedCall(callCost);
    } catch (error: unknown) {
      failure = error;
    }
    if (!(failure instanceof ApplicationFailure)) {
      throw new TypeError("Expected a non-retryable ApplicationFailure");
    }
    expect(failure.type).toBe("GlitterGenerationBudgetExhausted");
    expect(failure.nonRetryable).toBe(true);
  });

  test("restores same-run hit spend without charging prior-run hits", () => {
    const budget = new GenerationBudget(1);
    budget.setPreflightEstimatedCostUsd(0.5);
    budget.record({
      response: { value: "first" },
      key: "artifact-a",
      requestSha256: "a".repeat(64),
      cacheStatus: "miss",
      billedToCurrentRun: true,
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 5,
        costUsd: 0.25,
      },
    });
    budget.record({
      response: { value: "first" },
      key: "artifact-a",
      requestSha256: "a".repeat(64),
      cacheStatus: "hit",
      billedToCurrentRun: true,
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 5,
        costUsd: 0.25,
      },
    });
    budget.record({
      response: { value: "second" },
      key: "artifact-b",
      requestSha256: "b".repeat(64),
      cacheStatus: "hit",
      billedToCurrentRun: true,
      usage: {
        inputTokens: 60,
        outputTokens: 10,
        cachedInputTokens: 3,
        costUsd: 0.15,
      },
    });
    budget.record({
      response: { value: "prior dry run" },
      key: "artifact-c",
      requestSha256: "c".repeat(64),
      cacheStatus: "hit",
      billedToCurrentRun: false,
      usage: {
        inputTokens: 500,
        outputTokens: 100,
        cachedInputTokens: 50,
        costUsd: 0.5,
      },
    });

    expect(budget.summary()).toEqual({
      maxUncachedCostUsd: 1,
      preflightEstimatedCostUsd: 0.5,
      actualUncachedCostUsd: 0.4,
      cacheHits: 3,
      cacheMisses: 1,
      inputTokens: 160,
      outputTokens: 30,
      cachedInputTokens: 8,
      artifactKeys: ["artifact-a", "artifact-b", "artifact-c"],
    });
  });
});
