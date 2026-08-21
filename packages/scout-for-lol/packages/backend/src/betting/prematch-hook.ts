import type { ActionRowBuilder, ButtonBuilder } from "discord.js";
import type {
  DiscordGuildId,
  PlayerConfigEntry,
  QueueType,
  RawCurrentGameInfo,
  BucksPrediction,
} from "@scout-for-lol/data";
import { buildBettingRows } from "#src/betting/components.ts";
import { awardClassicPrematchForGame } from "#src/betting/classic-prematch-earnings.ts";
import { isBettableGame, isStandardLobby } from "#src/betting/eligibility.ts";
import {
  bettingEnabledGuilds,
  openBettingPoolsForPrematch,
} from "#src/betting/pool-open.ts";
import { bucksPrematchSummary } from "#src/betting/prematch-line.ts";
import { buildRosterForButtons } from "#src/betting/prematch-subject.ts";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";

/**
 * Everything the prematch notification needs to offer betting on one game.
 *
 * Extracted from `sendPrematchNotification` so that function stays a delivery
 * routine: it should decide where a message goes, not how a market is priced.
 */

export type BucksPrematchAttachment = {
  /** Guilds that got a pool, and so should see buttons. */
  bettingGuildIds: Set<DiscordGuildId>;
  /** The button rows, or empty when nobody in the game can be bet on. */
  rows: ActionRowBuilder<ButtonBuilder>[];
  /** The public live-market summary appended to the message content. */
  footer: string;
  matchId: string;
};

/**
 * Open the markets and build the message furniture.
 *
 * Never throws: `openBettingPoolsForPrematch` swallows its own failures and
 * returns an empty set, which collapses this to "no buttons, no footer" — the
 * prematch notification still goes out unchanged.
 */
export async function prepareBucksPrematch(
  input: {
    gameInfo: RawCurrentGameInfo;
    trackedPlayers: readonly PlayerConfigEntry[];
    queueType: QueueType | undefined;
    targetGuildIds: readonly DiscordGuildId[];
    detectedAt: Date;
    prediction: BucksPrediction | undefined;
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<BucksPrematchAttachment> {
  const matchId = `${input.gameInfo.platformId}_${input.gameInfo.gameId.toString()}`;
  const trackedAliasByPuuid = new Map(
    input.trackedPlayers.map((player) => [
      player.league.leagueAccount.puuid,
      player.alias,
    ]),
  );

  const enabledGuilds = bettingEnabledGuilds(input.targetGuildIds);
  if (
    input.queueType === "classic" &&
    enabledGuilds.length > 0 &&
    isStandardLobby(input.gameInfo.participants)
  ) {
    await awardClassicPrematchForGame(
      {
        matchId,
        gameInfo: input.gameInfo,
        trackedAliasByPuuid,
        serverIds: enabledGuilds,
        detectedAt: input.detectedAt,
      },
      prismaClient,
    );
    return {
      bettingGuildIds: new Set<DiscordGuildId>(),
      rows: [],
      footer: "",
      matchId,
    };
  }

  const bettable = isBettableGame({
    queueType: input.queueType,
    participants: input.gameInfo.participants,
  });
  if (!bettable || enabledGuilds.length === 0) {
    return {
      bettingGuildIds: new Set<DiscordGuildId>(),
      rows: [],
      footer: "",
      matchId,
    };
  }

  const bettingGuildIds = await openBettingPoolsForPrematch(
    {
      matchId,
      gameInfo: input.gameInfo,
      queueType: input.queueType,
      guildIds: enabledGuilds,
      detectedAt: input.detectedAt,
      trackedAliasByPuuid,
      prediction: input.prediction,
    },
    prismaClient,
  );

  const rows =
    bettingGuildIds.size === 0
      ? []
      : buildBettingRows({
          matchId,
          roster: buildRosterForButtons(input.gameInfo, trackedAliasByPuuid),
        });

  const footer = bucksPrematchSummary({
    prediction: input.prediction,
    poolState: "open",
    positions: [],
  });

  return { bettingGuildIds, rows, footer, matchId };
}
