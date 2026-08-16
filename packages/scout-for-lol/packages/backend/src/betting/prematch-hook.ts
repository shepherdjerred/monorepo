import type { ActionRowBuilder, ButtonBuilder } from "discord.js";
import type {
  DiscordGuildId,
  LoadingScreenData,
  PlayerConfigEntry,
  QueueType,
  RawCurrentGameInfo,
} from "@scout-for-lol/data";
import { buildBettingRows } from "#src/betting/components.ts";
import {
  computeClosesAt,
  openBettingPoolsForPrematch,
} from "#src/betting/pool-open.ts";
import { buildPrediction } from "#src/betting/prediction-inputs.ts";
import { bucksPrematchLine } from "#src/betting/prematch-line.ts";
import {
  buildRosterForButtons,
  resolveSubjectChampion,
  resolveSubjectTeam,
} from "#src/betting/prematch-subject.ts";

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
  /** The prediction + countdown lines appended to the message content. */
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
export async function prepareBucksPrematch(input: {
  gameInfo: RawCurrentGameInfo;
  trackedPlayers: readonly PlayerConfigEntry[];
  queueType: QueueType | undefined;
  targetGuildIds: readonly DiscordGuildId[];
  loadingScreenData: LoadingScreenData | undefined;
  detectedAt: Date;
}): Promise<BucksPrematchAttachment> {
  const matchId = `${input.gameInfo.platformId}_${input.gameInfo.gameId.toString()}`;
  const trackedAliasByPuuid = new Map(
    input.trackedPlayers.map((player) => [
      player.league.leagueAccount.puuid,
      player.alias,
    ]),
  );

  const subject = input.trackedPlayers[0];
  const prediction =
    subject === undefined || input.loadingScreenData === undefined
      ? undefined
      : await buildPrediction({
          loadingScreenData: input.loadingScreenData,
          subject: {
            puuid: subject.league.leagueAccount.puuid,
            alias: subject.alias,
            team: resolveSubjectTeam(
              input.loadingScreenData,
              subject.league.leagueAccount.puuid,
            ),
            championName: resolveSubjectChampion(
              input.loadingScreenData,
              subject.league.leagueAccount.puuid,
            ),
          },
          matchId,
        });

  const bettingGuildIds = await openBettingPoolsForPrematch({
    matchId,
    gameInfo: input.gameInfo,
    queueType: input.queueType,
    guildIds: input.targetGuildIds,
    detectedAt: input.detectedAt,
    trackedAliasByPuuid,
    prediction,
  });

  const rows =
    bettingGuildIds.size === 0
      ? []
      : buildBettingRows({
          matchId,
          roster: buildRosterForButtons(input.gameInfo, trackedAliasByPuuid),
        });

  const footer = bucksPrematchLine({
    closesAt: computeClosesAt({
      detectedAt: input.detectedAt,
      gameStartTime: input.gameInfo.gameStartTime,
    }),
    prediction,
  });

  return { bettingGuildIds, rows, footer, matchId };
}
