import { describe, expect, test } from "vitest";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import {
  BUCKS_ASK_MODEL_LIMITS,
  BucksAskUnavailableError,
  bucksAskStepOutputBudget,
  runBucksAskAgent,
  type BucksAskModelRunner,
} from "#src/betting/ask-agent.ts";
import {
  BucksAccountQuerySchema,
  BucksBetQuerySchema,
  BucksLedgerQuerySchema,
} from "#src/betting/ask-analytics-schema.ts";
import type { BucksAskAnalyticsDataset } from "#src/betting/ask-analytics.ts";
import {
  bucksTestDiscordId,
  bucksTestPuuid,
} from "#src/testing/bucks-fixtures.ts";
import { scoutBucksAskTokensUsedTotal } from "#src/metrics/bucks-ask.ts";

const SERVER = DiscordGuildIdSchema.parse("1337623164146155593");
const SUBJECT = bucksTestPuuid(0);

describe("Bryan Bucks ask agent", () => {
  test("runs a deterministic model against only the typed toolbox", async () => {
    const promptTokensBefore = await tokenCount("prompt");
    const completionTokensBefore = await tokenCount("completion");
    const result = await runBucksAskAgent(agentRequest(), {
      loadDataset: async () => dataset(),
      runModel: deterministicModelRunner,
      now: () => new Date("2026-01-08T12:00:00.000Z"),
    });

    expect(result).toMatchObject({
      model: "gpt-5.6-luna",
      inputTokens: 120,
      outputTokens: 30,
    });
    expect(result.answer).toContain("20 BB");
    expect(await tokenCount("prompt")).toBe(promptTokensBefore + 120);
    expect(await tokenCount("completion")).toBe(completionTokensBefore + 30);
  });

  test("rejects an unavailable live model before loading history", async () => {
    let loaded = false;
    await expect(
      runBucksAskAgent(agentRequest(), {
        getRuntime: unavailableRuntime,
        loadDataset: async () => {
          loaded = true;
          return dataset();
        },
      }),
    ).rejects.toBeInstanceOf(BucksAskUnavailableError);
    expect(loaded).toBe(false);
  });

  test("enforces strict, bounded aggregation schemas", () => {
    expect(
      BucksAccountQuerySchema.safeParse({
        measures: ["balance_bb"],
        groupBy: ["bettor"],
      }).success,
    ).toBe(false);
    expect(
      BucksBetQuerySchema.safeParse({
        measures: ["net_bb"],
        groupBy: ["bettor", "subject", "day"],
      }).success,
    ).toBe(false);
    expect(
      BucksLedgerQuerySchema.safeParse({
        measures: ["delta_bb"],
        filters: { kinds: ["seed"] },
      }).success,
    ).toBe(true);
    expect(
      BucksLedgerQuerySchema.safeParse({
        measures: ["delta_bb"],
        groupBy: ["bettor"],
        filters: { kinds: ["earn_game"] },
      }).success,
    ).toBe(false);
    expect(
      BucksLedgerQuerySchema.safeParse({
        measures: ["delta_bb"],
        filters: {
          kinds: ["earn_game"],
          bettorDiscordIds: [bucksTestDiscordId(1)],
        },
      }).success,
    ).toBe(false);
    expect(
      BucksBetQuerySchema.safeParse({
        measures: ["net_bb"],
        limit: 11,
      }).success,
    ).toBe(false);
    expect(
      BucksBetQuerySchema.safeParse({
        measures: ["position_count"],
        filters: { outcomes: ["cancelled"] },
      }).success,
    ).toBe(false);
  });

  test("enforces tool and model output limits", async () => {
    expect(BUCKS_ASK_MODEL_LIMITS).toEqual({
      steps: 4,
      toolCalls: 5,
      aggregateCalls: 2,
      outputTokens: 2000,
      answerCharacters: 3200,
    });

    await expect(
      runBucksAskAgent(agentRequest(), {
        loadDataset: async () => dataset(),
        runModel: tooManyAggregationRunner,
      }),
    ).rejects.toThrow("too many Bryan Bucks aggregations");

    const completionTokensBefore = await tokenCount("completion");
    await expect(
      runBucksAskAgent(agentRequest(), {
        loadDataset: async () => dataset(),
        runModel: async () => ({
          answer: "x".repeat(BUCKS_ASK_MODEL_LIMITS.answerCharacters + 1),
          usage: { inputTokens: 7, outputTokens: 3 },
        }),
      }),
    ).rejects.toThrow();
    expect(await tokenCount("completion")).toBe(completionTokensBefore + 3);
  });

  test("rejects an answer without a successful analytics tool result", async () => {
    await expect(
      runBucksAskAgent(agentRequest(), {
        loadDataset: async () => dataset(),
        runModel: async () => ({
          answer: "Invented ranking with no evidence.",
          usage: { inputTokens: 7, outputTokens: 3 },
        }),
      }),
    ).rejects.toThrow("did not use a successful analytics tool result");
  });

  test("shares the output-token cap across every model step", () => {
    expect(bucksAskStepOutputBudget(0, 0)).toEqual({
      forceFinal: false,
      maxOutputTokens: 1000,
    });
    expect(bucksAskStepOutputBudget(1, 1000)).toEqual({
      forceFinal: true,
      maxOutputTokens: 1000,
    });
    expect(bucksAskStepOutputBudget(3, 250)).toEqual({
      forceFinal: true,
      maxOutputTokens: 1750,
    });
    expect(() => bucksAskStepOutputBudget(1, 2000)).toThrow(
      "exhausted its Bryan Bucks output budget",
    );
  });

  test("does not settle an aborted analysis before its underlying work", async () => {
    const controller = new AbortController();
    let releaseDataset: ((value: BucksAskAnalyticsDataset) => void) | undefined;
    const pendingDataset = new Promise<BucksAskAnalyticsDataset>((resolve) => {
      releaseDataset = resolve;
    });
    const analysis = runBucksAskAgent(
      { ...agentRequest(), abortSignal: controller.signal },
      {
        loadDataset: async () => await pendingDataset,
        runModel: deterministicModelRunner,
      },
    );
    let settled = false;
    const settlementObserver = observeSettlement();

    controller.abort(new Error("test timeout"));
    await Promise.resolve();
    expect(settled).toBe(false);

    if (releaseDataset === undefined) {
      throw new Error("dataset load did not start");
    }
    releaseDataset(dataset());
    await expect(analysis).rejects.toThrow("test timeout");
    await settlementObserver;
    expect(settled).toBe(true);

    async function observeSettlement(): Promise<void> {
      try {
        await analysis;
      } catch {
        // The assertion above verifies the expected rejection.
      } finally {
        settled = true;
      }
    }
  });
});

const deterministicModelRunner: BucksAskModelRunner = async (modelRequest) => {
  const overview = await modelRequest.toolbox.getDataset();
  const account = await modelRequest.toolbox.queryAccounts({
    measures: ["balance_bb"],
  });
  const result = await modelRequest.toolbox.queryBets({
    measures: ["net_bb", "settled_position_count"],
    groupBy: ["bettor"],
  });
  expect(overview.positionCount).toBe(1);
  expect(account.rows[0]?.metrics).toEqual([
    { name: "balance_bb", value: 120 },
  ]);
  expect(result.coverage.financialPositions).toBe(1);
  expect(modelRequest.model).toBe("gpt-5.6-luna");
  expect(modelRequest.currentTime).toBe("2026-01-08T12:00:00.000Z");
  return {
    answer: `<@${bucksTestDiscordId(1)}> gained 20 BB across 1 settled position from 2026-01-01 to 2026-01-01.`,
    usage: { inputTokens: 120, outputTokens: 30 },
  };
};

const tooManyAggregationRunner: BucksAskModelRunner = async (modelRequest) => {
  await modelRequest.toolbox.queryAccounts({ measures: ["balance_bb"] });
  await modelRequest.toolbox.queryAccounts({ measures: ["balance_bb"] });
  await modelRequest.toolbox.queryAccounts({ measures: ["balance_bb"] });
  return { answer: "unreachable", usage: emptyUsage() };
};

function agentRequest() {
  return {
    runId: "bb-ask-test-run",
    serverId: SERVER,
    discordId: bucksTestDiscordId(1),
    question: "Who gained the most BB?",
    abortSignal: new AbortController().signal,
  };
}

function emptyUsage() {
  return { inputTokens: 0, outputTokens: 0 };
}

async function tokenCount(kind: "completion" | "prompt"): Promise<number> {
  const metric = await scoutBucksAskTokensUsedTotal.get();
  return (
    metric.values.find(
      (value) =>
        value.labels.model === "gpt-5.6-luna" && value.labels.kind === kind,
    )?.value ?? 0
  );
}

function unavailableRuntime(): undefined {
  return;
}

function dataset(): BucksAskAnalyticsDataset {
  const discordId = bucksTestDiscordId(1);
  const occurredAt = new Date("2026-01-01T12:00:00.000Z");
  return {
    loadedAt: occurredAt,
    accounts: [
      { discordId, balance: 120, createdAt: occurredAt },
      {
        discordId: bucksTestDiscordId(2),
        balance: 999,
        createdAt: occurredAt,
      },
    ],
    ledger: [],
    bets: [
      {
        positionType: "outcome",
        discordId,
        matchId: "NA1_TEST",
        marketKey: "outcome:1",
        subjectPuuid: SUBJECT,
        subjectAlias: "jerred",
        subjectAliases: ["jerred"],
        subjectTeamId: 100,
        direction: "for",
        subjectResult: "won",
        outcome: "won",
        stake: 10,
        payout: 30,
        grossPayout: 30,
        netBb: 20,
        createdAt: occurredAt,
        eventAt: occurredAt,
      },
    ],
    marketCount: 1,
    aliasesByPuuid: new Map([
      [
        SUBJECT,
        {
          latestAlias: "jerred",
          latestAt: occurredAt,
          aliases: new Set(["jerred"]),
        },
      ],
    ]),
  };
}
