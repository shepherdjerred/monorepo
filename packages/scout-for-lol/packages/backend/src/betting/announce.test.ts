import { describe, expect, test } from "vitest";
import type { MessageCreateOptions } from "discord.js";
import {
  BucksPredictionSchema,
  type BucksPrediction,
} from "@scout-for-lol/data/index.ts";
import {
  buildAnnouncements,
  sendSettlementMessage,
} from "#src/betting/announce.ts";
import {
  buildSettlementMessage,
  formatSettlementBody,
  predictionVerdict,
} from "#src/betting/outcome-message.ts";
import { HOUSE_ACCOUNT_DISCORD_ID } from "#src/betting/constants.ts";
import type { SettlementSummary } from "#src/betting/settle.ts";
import { bucksTestDiscordId } from "#src/testing/bucks-fixtures.ts";
import {
  ChannelSendError,
  markReplyPermissionError,
} from "#src/league/discord/channel.ts";

const WINNER_DISCORD_ID = bucksTestDiscordId(1);
const LOSER_DISCORD_ID = bucksTestDiscordId(2);

function firstEmbedJson(message: MessageCreateOptions) {
  const embed = message.embeds?.[0];
  if (embed === undefined) {
    throw new Error("expected a settlement embed");
  }
  return "toJSON" in embed ? embed.toJSON() : embed;
}

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
  test("scores canonical v2 Blue probability against either result", () => {
    const v2 = BucksPredictionSchema.parse({
      version: 2,
      blueWinProbability: 0.72,
      dataQuality: "high",
      coverage: { covered: 50, applicable: 50 },
      drivers: ["Blue rank edge"],
    });
    expect(predictionVerdict(v2, 100)).toBe("Scout called it.");
    expect(predictionVerdict(v2, 200)).toBe("Scout was wrong.");
  });

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
          submittedStake: 10,
          matchedStake: 10,
          unmatchedStake: 0,
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
          submittedStake: 10,
          matchedStake: 10,
          unmatchedStake: 0,
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
      includeOutcome: true,
      parlay: undefined,
      framing: undefined,
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
      `• <@${WINNER_DISCORD_ID}> Blue 10 → matched **10** · +**6 BB** (20 − 4 fee = 16 back)`,
    );
    expect(body).toContain("Matched pool **20 BB** · winner fees **4 BB**");
    expect(body).toContain(
      `• <@${LOSER_DISCORD_ID}> Red 10 → matched **10** · −**10 BB**`,
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
          submittedStake: 14,
          matchedStake: 10,
          unmatchedStake: 4,
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
      includeOutcome: true,
      parlay: undefined,
      framing: undefined,
      summary,
      earnings: [],
      predictionSentence: undefined,
      predictionVerdictLine: undefined,
    });

    expect(body).toContain(
      `• <@${WINNER_DISCORD_ID}> Blue 14 → matched **10**, refunded **4** · refunded **10 BB**`,
    );
    expect(body).toContain("Matched pool **10 BB** · winner fees **0 BB**");
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
          submittedStake: 1,
          matchedStake: 1,
          unmatchedStake: 0,
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
          submittedStake: 1,
          matchedStake: 1,
          unmatchedStake: 0,
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
      includeOutcome: true,
      parlay: undefined,
      framing: undefined,
      summary,
      earnings: [],
      predictionSentence: undefined,
      predictionVerdictLine: undefined,
    });

    expect(body).toContain("Matched pool **2 BB** · winner fees **0 BB**");
    expect(body).toContain(
      "Blue 1 → matched **1** · +**1 BB** (2 − 0 fee = 2 back)",
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
          submittedStake: 25,
          matchedStake: 25,
          unmatchedStake: 0,
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
          submittedStake: 25,
          matchedStake: 25,
          unmatchedStake: 0,
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
      includeOutcome: true,
      parlay: undefined,
      framing: undefined,
      summary,
      earnings: [],
      predictionSentence: undefined,
      predictionVerdictLine: undefined,
    });

    expect(body).toContain(
      "🏦 Bryan Bucks house matched 25 BB on the other side.",
    );
    expect(body).not.toContain(`<@${HOUSE_ACCOUNT_DISCORD_ID}>`);
    expect(body).toContain(
      `• <@${WINNER_DISCORD_ID}> Blue 25 → matched **25**`,
    );
  });
});

describe("settlement outcome message", () => {
  test("fits a full settlement into one bounded embed", () => {
    const summary: SettlementSummary = {
      matchId: "NA1_5000000042",
      serverId: "1337623164146155593",
      winningTeamId: 100,
      voidReason: undefined,
      winnersPool: 80,
      losersPool: 75,
      houseCut: 32,
      bets: Array.from({ length: 16 }, (_, index) => ({
        betId: index + 1,
        bucksAccountId: index + 1,
        discordId: bucksTestDiscordId(index + 1),
        isHouse: false,
        predictedTeamId: 100,
        submittedStake: 5,
        matchedStake: 5,
        unmatchedStake: 0,
        grossPayout: 10,
        houseCut: 2,
        payout: 8,
        winnings: 3,
        won: true,
        refunded: false,
        subjectPuuid: `winner-puuid-${index.toString()}`,
      })),
    };
    const outcomeInput = {
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
          alias: "DianaDianaDianaDianaDianaDianaDianaDianaDianaDiana",
          reasons: ["played", "win", "mvp"],
          total: 9,
        },
      ],
      predictionSentence:
        "Scout gave this roster a decisive edge before the match started.",
      predictionVerdictLine: "Scout called it.",
      includeOutcome: true,
      parlay: undefined,
      framing: undefined,
    } satisfies Parameters<typeof formatSettlementBody>[0];
    const body = formatSettlementBody(outcomeInput);
    const message = buildSettlementMessage(outcomeInput);

    // The plain-text body is now well under one Discord message: the same
    // settlement rendered at 2,300+ characters before the copy consolidation.
    expect(body.length).toBeGreaterThan(1000);
    expect(body.length).toBeLessThan(1900);
    expect(message.content).toBeUndefined();
    expect(message.embeds).toHaveLength(1);
    expect(message.allowedMentions).toEqual({ parse: [] });
    const embed = firstEmbedJson(message);
    const fields = embed.fields ?? [];
    expect(fields.every((field) => field.value.length <= 1024)).toBe(true);
    const delivered = [
      embed.description ?? "",
      ...fields.map((field) => `${field.name}\n${field.value}`),
    ].join("\n");
    const embedLength =
      (embed.title?.length ?? 0) +
      (embed.description?.length ?? 0) +
      fields.reduce(
        (total, field) => total + field.name.length + field.value.length,
        0,
      );
    expect(embedLength).toBeLessThanOrEqual(6000);
    expect(delivered).toContain(
      "Matched pool **80 BB** · winner fees **32 BB**",
    );
    expect(delivered).toContain("+**3 BB** (10 − 2 fee = 8 back)");
    expect(delivered).toContain("🪙 **Aaron** +13 BB");
    expect(delivered).toContain("…and 1 more — see `/bb history`");
  });
});

describe("settlement outcome bounds", () => {
  test("truncates an overlong earning alias without dropping the outcome", () => {
    const message = buildSettlementMessage({
      includeOutcome: true,
      parlay: undefined,
      framing: undefined,
      summary: {
        matchId: "NA1_5000000042",
        serverId: "1337623164146155593",
        winningTeamId: 100,
        voidReason: undefined,
        winnersPool: 0,
        losersPool: 0,
        houseCut: 0,
        bets: [],
      },
      earnings: [
        {
          serverId: "1337623164146155593",
          discordId: WINNER_DISCORD_ID,
          alias: "A".repeat(2000),
          reasons: ["played"],
          total: 1,
        },
      ],
      predictionSentence: undefined,
      predictionVerdictLine: undefined,
    });

    const fields = firstEmbedJson(message).fields ?? [];
    expect(fields.every((field) => field.value.length <= 1024)).toBe(true);
    expect(fields.map((field) => field.value).join("\n")).toContain(
      `${"A".repeat(99)}…** +1 BB (played)`,
    );
  });
});

const SERVER_ID = "1337623164146155593";

function parlaySummary(serverId: string) {
  return {
    matchId: "NA1_1",
    serverId,
    yesResult: true,
    voidReason: undefined,
    legs: [],
    messageRefs: [],
    bets: [
      {
        discordId: bucksTestDiscordId(1),
        side: "YES" as const,
        stake: 5,
        grossPayout: 10,
        payout: 10,
        outcome: "won" as const,
      },
    ],
  };
}

describe("buildAnnouncements", () => {
  test("attaches a parlay to the guild's own outcome announcement", () => {
    const announcements = buildAnnouncements({
      closures: [],
      settlements: [
        {
          matchId: "NA1_1",
          serverId: SERVER_ID,
          winningTeamId: 100,
          voidReason: undefined,
          winnersPool: 5,
          losersPool: 5,
          houseCut: 1,
          bets: [],
        },
      ],
      parlaySettlements: [parlaySummary(SERVER_ID)],
    });

    expect(announcements).toHaveLength(1);
    expect(announcements[0]?.includeOutcome).toBe(true);
    expect(announcements[0]?.parlay).toBeDefined();
  });

  // Without this carrier the parlay result is lost outright:
  // settleParlaysForMatch returns nothing for it on any later pass, and the
  // pool it belongs to was already settled or voided by an earlier tick.
  test("carries a parlay whose pool this pass did not settle", () => {
    const announcements = buildAnnouncements({
      closures: [],
      settlements: [],
      parlaySettlements: [parlaySummary(SERVER_ID)],
    });

    expect(announcements).toHaveLength(1);
    expect(announcements[0]?.includeOutcome).toBe(false);
    expect(announcements[0]?.parlay).toBeDefined();
    expect(announcements[0]?.summary.bets).toEqual([]);
  });

  test("does not duplicate a guild that already has an announcement", () => {
    const announcements = buildAnnouncements({
      closures: [
        {
          matchId: "NA1_1",
          serverId: SERVER_ID,
          messageRefs: [],
          humanMatchedPerSide: 0,
          houseFill: 0,
          totalMatchedPerSide: 0,
          positions: [
            {
              betId: 1,
              discordId: bucksTestDiscordId(1),
              teamId: 100,
              submittedStake: 9,
              matchedStake: 0,
              unmatchedStake: 9,
            },
          ],
        },
      ],
      settlements: [],
      parlaySettlements: [parlaySummary(SERVER_ID)],
    });

    expect(announcements).toHaveLength(1);
    expect(announcements[0]?.includeOutcome).toBe(true);
    expect(announcements[0]?.parlay).toBeDefined();
  });

  test("announces nothing when there is nothing to say", () => {
    expect(
      buildAnnouncements({
        closures: [],
        settlements: [],
        parlaySettlements: [],
      }),
    ).toEqual([]);
  });
});

async function capturedNonce(kind: "outcome" | "parlay"): Promise<unknown> {
  const attempts: MessageCreateOptions[] = [];
  await sendSettlementMessage(
    {
      message: { embeds: [{ title: "Outcome" }] },
      matchId: "NA1_5000000042",
      channelId: "1337623164146155594",
      guildId: "1337623164146155593",
      kind,
    },
    {
      sendMessage: (options) => {
        attempts.push(options);
        return Promise.resolve(undefined);
      },
      sleep: () => Promise.resolve(),
    },
  );
  return attempts[0]?.nonce;
}

describe("sendSettlementMessage", () => {
  // The single highest-risk detail in merging the parlay result into this
  // embed. Before the discriminator, a parlay-only carrier delivered on a
  // later tick collided with the outcome embed already delivered to the same
  // channel for the same match, and enforceNonce dropped it — silently losing
  // a settlement that can never be re-derived.
  test("gives outcome and parlay carriers distinct nonces", async () => {
    const outcome = await capturedNonce("outcome");
    const parlay = await capturedNonce("parlay");

    expect(outcome).toBeDefined();
    expect(parlay).toBeDefined();
    expect(outcome).not.toEqual(parlay);
  });

  test("keeps a nonce stable for the same match, channel, and kind", async () => {
    expect(await capturedNonce("parlay")).toEqual(
      await capturedNonce("parlay"),
    );
  });

  test("retries one outcome with a stable nonce", async () => {
    const attempts: MessageCreateOptions[] = [];
    let sleeps = 0;
    let failuresRemaining = 2;

    await sendSettlementMessage(
      {
        message: { embeds: [{ title: "Outcome" }] },
        matchId: "NA1_5000000042",
        channelId: "1337623164146155594",
        guildId: "1337623164146155593",
        kind: "outcome",
      },
      {
        sendMessage: (options) => {
          attempts.push(options);
          if (failuresRemaining > 0) {
            failuresRemaining -= 1;
            return Promise.reject(new Error("Discord delivery failed"));
          }
          return Promise.resolve(undefined);
        },
        sleep: () => {
          sleeps += 1;
          return Promise.resolve();
        },
      },
    );

    expect(attempts).toHaveLength(3);
    expect(sleeps).toBe(2);
    expect(new Set(attempts.map((attempt) => attempt.nonce)).size).toBe(1);
    expect(attempts.every((attempt) => attempt.enforceNonce === true)).toBe(
      true,
    );
    expect(attempts.every((attempt) => attempt.embeds?.length === 1)).toBe(
      true,
    );
  });

  test("replies to the postmatch message without pinging bettors", async () => {
    const attempts: MessageCreateOptions[] = [];
    await sendSettlementMessage(
      {
        message: { embeds: [{ title: "Outcome" }] },
        matchId: "NA1_5000000042",
        channelId: "1337623164146155594",
        guildId: "1337623164146155593",
        kind: "outcome",
        postmatchMessageId: "postmatch-message",
      },
      {
        sendMessage: (options) => {
          attempts.push(options);
          return Promise.resolve(undefined);
        },
        sleep: () => Promise.resolve(),
      },
    );

    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.reply).toEqual({
      messageReference: "postmatch-message",
      failIfNotExists: false,
    });
    expect(attempts[0]?.allowedMentions).toEqual({ parse: [] });
  });

  test("falls back to one standalone outcome without reply permission", async () => {
    const attempts: MessageCreateOptions[] = [];
    const replyError = markReplyPermissionError(
      new ChannelSendError(
        "missing Read Message History",
        "1337623164146155594",
        true,
      ),
    );
    await sendSettlementMessage(
      {
        message: { embeds: [{ title: "Outcome" }] },
        matchId: "NA1_5000000042",
        channelId: "1337623164146155594",
        guildId: "1337623164146155593",
        kind: "outcome",
        postmatchMessageId: "postmatch-message",
      },
      {
        sendMessage: (options) => {
          attempts.push(options);
          return options.reply === undefined
            ? Promise.resolve(undefined)
            : Promise.reject(replyError);
        },
        sleep: () => Promise.resolve(),
      },
    );

    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.reply).toBeDefined();
    expect(attempts[1]?.reply).toBeUndefined();
    expect(attempts[0]?.nonce).toBe(attempts[1]?.nonce);
  });

  test("falls back when Discord rejects the reply after preflight", async () => {
    const attempts: MessageCreateOptions[] = [];
    const replyError = new ChannelSendError(
      "Discord rejected reply",
      "1337623164146155594",
      true,
      { code: 50_013, message: "Missing Permissions" },
    );

    await sendSettlementMessage(
      {
        message: { embeds: [{ title: "Outcome" }] },
        matchId: "NA1_5000000042",
        channelId: "1337623164146155594",
        guildId: "1337623164146155593",
        kind: "outcome",
        postmatchMessageId: "postmatch-message",
      },
      {
        sendMessage: (options) => {
          attempts.push(options);
          return options.reply === undefined
            ? Promise.resolve(undefined)
            : Promise.reject(replyError);
        },
        sleep: () => Promise.resolve(),
      },
    );

    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.reply).toBeDefined();
    expect(attempts[1]?.reply).toBeUndefined();
  });
});
