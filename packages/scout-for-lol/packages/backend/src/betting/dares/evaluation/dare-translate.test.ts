import { describe, expect, test } from "vitest";
import {
  StructuredOutputExhaustionError,
  createOpenRouterRuntime,
  emptyTokenBreakdown,
  type AggregateOpenRouterUsage,
} from "@shepherdjerred/llm-runtime";
import { DARE_DEFAULT_WINDOW_DAYS } from "#src/betting/constants.ts";
import type { DareModelTranslation } from "#src/betting/dares/evaluation/dare-model-schema.ts";
import {
  DareShortlistEntrySchema,
  type DareShortlistEntry,
} from "#src/betting/dares/dare-shortlist.ts";
import {
  translateDare,
  type TranslateDareDeps,
} from "#src/betting/dares/evaluation/dare-translate.ts";
import { LlmBudgetExceeded } from "#src/league/review/openai-budget.ts";
import {
  testAccountId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";

const SERVER_ID = testGuildId("901");
const CHALLENGER_ID = testAccountId("901");

function shortlistEntry(
  key: string,
  alias: string,
  id: string,
): DareShortlistEntry {
  return DareShortlistEntrySchema.parse({
    key,
    discordId: testAccountId(id),
    playerId: Number(id),
    alias,
    accounts: [
      {
        puuid: testPuuid(`dare-translate-${id}`),
        trackingStartedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
  });
}

const SHORTLIST: DareShortlistEntry[] = [
  shortlistEntry("T1", "alpha", "911"),
  shortlistEntry("T2", "beta", "912"),
];

// Constructing the runtime performs no network or metric registration; it is
// only ever handed to the mocked generate boundary.
const runtime = createOpenRouterRuntime({
  apiKey: "test-key",
  service: "dare-translate-test",
  appName: "dare-translate-test",
});

const RAW_TRANSLATED: DareModelTranslation = {
  unmappable: false,
  unmappableReason: null,
  targets: ["T2"],
  horizonKind: "window",
  windowDays: null,
  rootCombinator: "all",
  clauseCombinators: ["all"],
  leaves: [
    {
      clauseIndex: 0,
      requiredGames: 7,
      kind: "participant_boolean",
      numericField: null,
      booleanField: "win",
      rateField: null,
      operator: null,
      threshold: null,
      thresholdScaled: null,
      expected: true,
      champion: null,
    },
  ],
};

const RAW_UNMAPPABLE: DareModelTranslation = {
  ...RAW_TRANSLATED,
  unmappable: true,
  unmappableReason: "Maintain-every-game claims are not expressible",
  targets: [],
  clauseCombinators: [],
  leaves: [],
};

function usageOf(input: number, output: number): AggregateOpenRouterUsage {
  return {
    tokens: {
      ...emptyTokenBreakdown(),
      input,
      output,
      total: input + output,
    },
    actualCostUsd: 0,
    catalogCostUsd: 0,
    upstreamCostUsd: 0,
  };
}

type DepsOverrides = Partial<TranslateDareDeps> & {
  raw?: DareModelTranslation;
};

function makeDeps(overrides: DepsOverrides = {}): {
  deps: TranslateDareDeps;
  generateCalls: () => number;
  usageRecords: { model: string; tokens: { input: number; output: number } }[];
} {
  const { raw: rawOverride, ...depOverrides } = overrides;
  const raw = rawOverride ?? RAW_TRANSLATED;
  let generateCallCount = 0;
  const usageRecords: {
    model: string;
    tokens: { input: number; output: number };
  }[] = [];
  const deps: TranslateDareDeps = {
    loadShortlist: () => Promise.resolve(SHORTLIST),
    getRuntime: () => runtime,
    assertBudget: () => {
      // within budget
    },
    recordUsage: (model, tokens) => {
      usageRecords.push({
        model,
        tokens: { input: tokens.input, output: tokens.output },
      });
    },
    generate: (_runtime, input) => {
      generateCallCount += 1;
      return Promise.resolve({
        object: input.schema.parse(raw),
        usage: usageOf(120, 40),
        metadata: [],
        attempts: [],
      });
    },
    model: () => "test-model",
    ...depOverrides,
  };
  return { deps, generateCalls: () => generateCallCount, usageRecords };
}

const INPUT = {
  serverId: SERVER_ID,
  challengerDiscordId: CHALLENGER_ID,
  text: "I bet beta can't win 7 games this week",
};

describe("translateDare", () => {
  test("returns the canonical translation with its frozen record", async () => {
    const { deps, usageRecords } = makeDeps();
    const result = await translateDare(INPUT, deps);
    expect(result.kind).toBe("translated");
    if (result.kind !== "translated") {
      throw new Error("expected a translated result");
    }
    expect(result.targets.map((target) => target.alias)).toEqual(["beta"]);
    expect(result.horizonKind).toBe("window");
    expect(result.windowDays).toBe(DARE_DEFAULT_WINDOW_DAYS);
    expect(result.conditions.root.clauses).toHaveLength(1);
    expect(result.record).toEqual({
      promptVersion: "1",
      model: "test-model",
      usage: usageOf(120, 40),
      shortlistKeys: ["T1", "T2"],
      rawOutput: RAW_TRANSLATED,
    });
    expect(usageRecords).toEqual([
      { model: "test-model", tokens: { input: 120, output: 40 } },
    ]);
  });

  test("maps a model refusal to unmappable with its reason", async () => {
    const { deps } = makeDeps({ raw: RAW_UNMAPPABLE });
    await expect(translateDare(INPUT, deps)).resolves.toEqual({
      kind: "unmappable",
      reason: "Maintain-every-game claims are not expressible",
    });
  });

  test("an empty shortlist is unmappable before any model call", async () => {
    const { deps, generateCalls } = makeDeps({
      loadShortlist: () => Promise.resolve([]),
    });
    const result = await translateDare(INPUT, deps);
    expect(result).toEqual({
      kind: "unmappable",
      reason:
        "No other tracked players with linked League accounts to dare in this server.",
    });
    expect(generateCalls()).toBe(0);
  });

  test("a timed-out provider call maps to timeout", async () => {
    const { deps } = makeDeps({
      generate: () => {
        const error = new Error("The operation timed out");
        error.name = "TimeoutError";
        return Promise.reject(error);
      },
    });
    await expect(translateDare(INPUT, deps)).resolves.toEqual({
      kind: "timeout",
    });
  });

  test("a budget refusal never reaches the model", async () => {
    const { deps, generateCalls } = makeDeps({
      assertBudget: () => {
        throw new LlmBudgetExceeded("hourly", 100, 50);
      },
    });
    await expect(translateDare(INPUT, deps)).resolves.toEqual({
      kind: "budget_refused",
    });
    expect(generateCalls()).toBe(0);
  });

  test("exhausted structured output maps to invalid_output and still charges usage", async () => {
    const { deps, usageRecords } = makeDeps({
      generate: () =>
        Promise.reject(
          new StructuredOutputExhaustionError(
            "no valid object",
            [],
            usageOf(300, 200),
          ),
        ),
    });
    await expect(translateDare(INPUT, deps)).resolves.toEqual({
      kind: "invalid_output",
    });
    expect(usageRecords).toEqual([
      { model: "test-model", tokens: { input: 300, output: 200 } },
    ]);
  });

  test("an unexpected provider failure maps to provider_error", async () => {
    const { deps } = makeDeps({
      generate: () => Promise.reject(new Error("connection reset")),
    });
    await expect(translateDare(INPUT, deps)).resolves.toEqual({
      kind: "provider_error",
    });
  });

  test("a missing OpenRouter runtime maps to provider_error", async () => {
    const { deps, generateCalls } = makeDeps({
      // What a keyless deployment's getOpenRouterRuntime answers.
      getRuntime: ():
        ReturnType<typeof createOpenRouterRuntime> | undefined => {
        return undefined;
      },
    });
    await expect(translateDare(INPUT, deps)).resolves.toEqual({
      kind: "provider_error",
    });
    expect(generateCalls()).toBe(0);
  });
});
