import { describe, expect, test } from "bun:test";
import {
  BucksPredictionSchema,
  type BucksPrediction,
} from "@scout-for-lol/data/index.ts";
import {
  formatSettlementBody,
  predictionVerdict,
} from "#src/betting/announce.ts";
import { HOUSE_ACCOUNT_DISCORD_ID } from "#src/betting/constants.ts";
import type { SettlementSummary } from "#src/betting/settle.ts";
import { bucksTestDiscordId } from "#src/testing/bucks-fixtures.ts";

const WINNER_DISCORD_ID = bucksTestDiscordId(1);
const LOSER_DISCORD_ID = bucksTestDiscordId(2);

function prediction(
  winProbability: number,
  subjectTeamId = 100,
): BucksPrediction {
  return BucksPredictionSchema.parse({
    winProbability,
    subjectTeamId,
    confidence: "low",
    sentence: "Coin flip.",
    drivers: [],
  });
}

describe("predictionVerdict", () => {
  test("scores a confident call that landed", () => {
    expect(predictionVerdict(prediction(0.72, 100), 100)).toBe(
      "Scout called it.",
    );
    expect(predictionVerdict(prediction(0.28, 100), 200)).toBe(
      "Scout called it.",
    );
  });

  test("scores a confident call that missed", () => {
    expect(predictionVerdict(prediction(0.72, 100), 200)).toBe(
      "Scout was wrong.",
    );
    expect(predictionVerdict(prediction(0.28, 100), 100)).toBe(
      "Scout was wrong.",
    );
  });

  // The formula has no intercept, so a symmetric lobby returns exactly 0.500 —
  // a supported result, and a declined call rather than a call that the subject
  // loses. Scoring it either way makes the recap claim a direction the stored
  // sentence never took.
  test("declines to score an exact coin flip, whichever side won", () => {
    expect(predictionVerdict(prediction(0.5, 100), 100)).toBeUndefined();
    expect(predictionVerdict(prediction(0.5, 100), 200)).toBeUndefined();
  });

  test("declines to score a near-even call", () => {
    expect(predictionVerdict(prediction(0.51, 100), 100)).toBeUndefined();
    expect(predictionVerdict(prediction(0.49, 100), 100)).toBeUndefined();
  });

  test("has no verdict without a prediction or a decided result", () => {
    expect(predictionVerdict(undefined, 100)).toBeUndefined();
    expect(predictionVerdict(prediction(0.72, 100), undefined)).toBeUndefined();
  });
});

describe("formatSettlementBody", () => {
  test("lists every bettor and the in-game player's earned Bucks", () => {
    const summary: SettlementSummary = {
      matchId: "NA1_5000000042",
      serverId: "1337623164146155593",
      winningTeamId: 100,
      voidReason: undefined,
      winnersPool: 10,
      losersPool: 10,
      bets: [
        {
          betId: 1,
          bucksAccountId: 1,
          discordId: WINNER_DISCORD_ID,
          isHouse: false,
          predictedTeamId: 100,
          stake: 10,
          payout: 20,
          winnings: 10,
          won: true,
          refunded: false,
          subjectPuuid: "winner-puuid",
        },
        {
          betId: 2,
          bucksAccountId: 2,
          discordId: LOSER_DISCORD_ID,
          isHouse: false,
          predictedTeamId: 200,
          stake: 10,
          payout: 0,
          winnings: 0,
          won: false,
          refunded: false,
          subjectPuuid: "loser-puuid",
        },
      ],
    };

    const body = formatSettlementBody({
      summary,
      earnings: [
        {
          serverId: summary.serverId,
          discordId: WINNER_DISCORD_ID,
          alias: "Aaron",
          reasons: ["played", "win"],
          total: 2,
        },
      ],
      predictionSentence: undefined,
      predictionVerdictLine: undefined,
    });

    expect(body).toContain(
      `• <@${WINNER_DISCORD_ID}> staked 10 BB → received 20 BB (+10 BB winnings)`,
    );
    expect(body).toContain(
      `• <@${LOSER_DISCORD_ID}> staked 10 BB → received 0 BB`,
    );
    expect(body).toContain("🪙 **Aaron** +2 BB (played, win)");
  });

  test("labels refunds while retaining the original stake", () => {
    const summary: SettlementSummary = {
      matchId: "NA1_5000000042",
      serverId: "1337623164146155593",
      winningTeamId: undefined,
      voidReason: "no_counterparty",
      winnersPool: 0,
      losersPool: 0,
      bets: [
        {
          betId: 1,
          bucksAccountId: 1,
          discordId: WINNER_DISCORD_ID,
          isHouse: false,
          predictedTeamId: 100,
          stake: 10,
          payout: 10,
          winnings: 0,
          won: false,
          refunded: true,
          subjectPuuid: "winner-puuid",
        },
      ],
    };

    const body = formatSettlementBody({
      summary,
      earnings: [],
      predictionSentence: undefined,
      predictionVerdictLine: undefined,
    });

    expect(body).toContain(
      `• <@${WINNER_DISCORD_ID}> staked 10 BB → refunded 10 BB`,
    );
  });

  test("summarizes the house without exposing its synthetic account", () => {
    const summary: SettlementSummary = {
      matchId: "NA1_5000000042",
      serverId: "1337623164146155593",
      winningTeamId: 100,
      voidReason: undefined,
      winnersPool: 25,
      losersPool: 25,
      bets: [
        {
          betId: 1,
          bucksAccountId: 1,
          discordId: WINNER_DISCORD_ID,
          isHouse: false,
          predictedTeamId: 100,
          stake: 25,
          payout: 50,
          winnings: 25,
          won: true,
          refunded: false,
          subjectPuuid: "winner-puuid",
        },
        {
          betId: 2,
          bucksAccountId: 2,
          discordId: HOUSE_ACCOUNT_DISCORD_ID,
          isHouse: true,
          predictedTeamId: 200,
          stake: 25,
          payout: 0,
          winnings: 0,
          won: false,
          refunded: false,
          subjectPuuid: "winner-puuid",
        },
      ],
    };

    const body = formatSettlementBody({
      summary,
      earnings: [],
      predictionSentence: undefined,
      predictionVerdictLine: undefined,
    });

    expect(body).toContain(
      "🏦 Bryan Bucks house matched 25 BB on the other side.",
    );
    expect(body).not.toContain(`<@${HOUSE_ACCOUNT_DISCORD_ID}>`);
    expect(body).toContain(`• <@${WINNER_DISCORD_ID}> staked 25 BB`);
  });
});
