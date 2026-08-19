import { describe, expect, test } from "bun:test";
import {
  BucksPredictionSchema,
  type BucksPrediction,
} from "@scout-for-lol/data/index.ts";
import {
  formatBetPlacementAnnouncement,
  formatSettlementBody,
  predictionVerdict,
  sendSettlementMessages,
  splitSettlementBody,
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
      houseCut: 4,
      bets: [
        {
          betId: 1,
          bucksAccountId: 1,
          discordId: WINNER_DISCORD_ID,
          isHouse: false,
          predictedTeamId: 100,
          stake: 10,
          grossPayout: 20,
          houseCut: 4,
          payout: 16,
          winnings: 6,
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
          grossPayout: 0,
          houseCut: 0,
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
          reasons: ["played", "clash bonus"],
          total: 11,
        },
      ],
      predictionSentence: undefined,
      predictionVerdictLine: undefined,
    });

    expect(body).toContain(
      `• <@${WINNER_DISCORD_ID}> staked 10 BB → gross 20 BB − 4 BB house cut = 16 BB received (+6 BB net winnings)`,
    );
    expect(body).toContain("Pool **20 BB** · house cut **4 BB**");
    expect(body).toContain("house cut **4 BB**");
    expect(body).toContain(
      `• <@${LOSER_DISCORD_ID}> staked 10 BB → received 0 BB`,
    );
    expect(body).toContain("🪙 **Aaron** +11 BB (played, clash bonus)");
  });

  test("labels refunds while retaining the original stake", () => {
    const summary: SettlementSummary = {
      matchId: "NA1_5000000042",
      serverId: "1337623164146155593",
      winningTeamId: undefined,
      voidReason: "no_counterparty",
      winnersPool: 0,
      losersPool: 0,
      houseCut: 0,
      bets: [
        {
          betId: 1,
          bucksAccountId: 1,
          discordId: WINNER_DISCORD_ID,
          isHouse: false,
          predictedTeamId: 100,
          stake: 10,
          grossPayout: 10,
          houseCut: 0,
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
      `• <@${WINNER_DISCORD_ID}> staked 10 BB → refunded 10 BB (no house cut)`,
    );
    expect(body).toContain("Pool **10 BB** · house cut **0 BB**");
  });
});

describe("formatSettlementBody house cuts", () => {
  test("shows complete arithmetic when a small winning payout has no cut", () => {
    const summary: SettlementSummary = {
      matchId: "NA1_5000000042",
      serverId: "1337623164146155593",
      winningTeamId: 100,
      voidReason: undefined,
      winnersPool: 1,
      losersPool: 1,
      houseCut: 0,
      bets: [
        {
          betId: 1,
          bucksAccountId: 1,
          discordId: WINNER_DISCORD_ID,
          isHouse: false,
          predictedTeamId: 100,
          stake: 1,
          grossPayout: 2,
          houseCut: 0,
          payout: 2,
          winnings: 1,
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
          stake: 1,
          grossPayout: 0,
          houseCut: 0,
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
      earnings: [],
      predictionSentence: undefined,
      predictionVerdictLine: undefined,
    });

    expect(body).toContain("Pool **2 BB** · house cut **0 BB**");
    expect(body).toContain(
      "staked 1 BB → gross 2 BB − 0 BB house cut = 2 BB received (+1 BB net winnings)",
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
      houseCut: 10,
      bets: [
        {
          betId: 1,
          bucksAccountId: 1,
          discordId: WINNER_DISCORD_ID,
          isHouse: false,
          predictedTeamId: 100,
          stake: 25,
          grossPayout: 50,
          houseCut: 10,
          payout: 40,
          winnings: 15,
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
          grossPayout: 0,
          houseCut: 0,
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

  test("splits a full settlement without dropping payout arithmetic", () => {
    const summary: SettlementSummary = {
      matchId: "NA1_5000000042",
      serverId: "1337623164146155593",
      winningTeamId: 100,
      voidReason: undefined,
      winnersPool: 75,
      losersPool: 75,
      houseCut: 30,
      bets: Array.from({ length: 15 }, (_, index) => ({
        betId: index + 1,
        bucksAccountId: index + 1,
        discordId: bucksTestDiscordId(index + 1),
        isHouse: false,
        predictedTeamId: 100,
        stake: 5,
        grossPayout: 10,
        houseCut: 2,
        payout: 8,
        winnings: 3,
        won: true,
        refunded: false,
        subjectPuuid: `winner-puuid-${index.toString()}`,
      })),
    };
    const body = formatSettlementBody({
      summary,
      earnings: [
        {
          serverId: summary.serverId,
          discordId: WINNER_DISCORD_ID,
          alias: "Aaron",
          reasons: ["played", "ranked 5s bonus", "win", "mvp"],
          total: 13,
        },
        {
          serverId: summary.serverId,
          discordId: bucksTestDiscordId(2),
          alias: "Bryan",
          reasons: ["played", "win"],
          total: 7,
        },
        {
          serverId: summary.serverId,
          discordId: bucksTestDiscordId(3),
          alias: "Chris",
          reasons: ["played", "clash bonus", "win"],
          total: 12,
        },
        {
          serverId: summary.serverId,
          discordId: bucksTestDiscordId(4),
          alias: "Diana",
          reasons: ["played", "win", "mvp"],
          total: 9,
        },
      ],
      predictionSentence:
        "Scout gave this roster a decisive edge before the match started.",
      predictionVerdictLine: "Scout called it.",
    });

    expect(body.length).toBeGreaterThan(1900);
    const chunks = splitSettlementBody(body);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1900);
    }
    const delivered = chunks.join("\n");
    expect(delivered).toContain("Pool **75 BB** · house cut **30 BB**");
    expect(delivered).toContain(
      "gross 10 BB − 2 BB house cut = 8 BB received (+3 BB net winnings)",
    );
    expect(delivered).toContain("🪙 **Aaron** +13 BB");
  });
});

describe("sendSettlementMessages", () => {
  test("retries a failed chunk and still attempts every later chunk", async () => {
    const attempts: {
      content: string | undefined;
      nonce: string | number | undefined;
      enforceNonce: boolean | undefined;
    }[] = [];
    let sleeps = 0;

    await expect(
      sendSettlementMessages(
        {
          messages: ["first", "failed", "last"],
          matchId: "NA1_5000000042",
          channelId: "1337623164146155594",
          guildId: "1337623164146155593",
        },
        {
          sendMessage: (options) => {
            attempts.push({
              content: options.content,
              nonce: options.nonce,
              enforceNonce: options.enforceNonce,
            });
            return options.content === "failed"
              ? Promise.reject(new Error("Discord delivery failed"))
              : Promise.resolve(undefined);
          },
          sleep: () => {
            sleeps += 1;
            return Promise.resolve();
          },
        },
      ),
    ).rejects.toThrow("failed to deliver 1/3 chunk(s)");

    expect(attempts.map((attempt) => attempt.content)).toEqual([
      "first",
      "failed",
      "failed",
      "failed",
      "last",
    ]);
    expect(sleeps).toBe(2);
    const failedAttempts = attempts.filter(
      (attempt) => attempt.content === "failed",
    );
    expect(new Set(failedAttempts.map((attempt) => attempt.nonce)).size).toBe(
      1,
    );
    expect(
      failedAttempts.every((attempt) => attempt.enforceNonce === true),
    ).toBe(true);
  });
});

describe("formatBetPlacementAnnouncement", () => {
  test("shows the increment and the bettor's total position", () => {
    expect(
      formatBetPlacementAnnouncement({
        discordId: WINNER_DISCORD_ID,
        subjectAlias: "Aaron",
        subjectWins: true,
        stake: 5,
        totalStake: 10,
      }),
    ).toBe(
      `🎲 <@${WINNER_DISCORD_ID}> staked **5 BB** on **Aaron WINS** (position: **10 BB**). **20% house cut on winning payouts**.`,
    );
  });
});
