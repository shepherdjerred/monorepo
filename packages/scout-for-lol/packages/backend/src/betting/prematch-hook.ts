import type { ActionRowBuilder, ButtonBuilder } from "discord.js";
import type {
  DiscordGuildId,
  LoadingScreenData,
  PlayerConfigEntry,
  QueueType,
  RawCurrentGameInfo,
} from "@scout-for-lol/data";
import { buildBettingRows } from "#src/betting/components.ts";
import { isBettableGame } from "#src/betting/eligibility.ts";
import {
  bettingEnabledGuilds,
  openBettingPoolsForPrematch,
} from "#src/betting/pool-open.ts";
import { buildPrediction } from "#src/betting/prediction-inputs.ts";
import { bucksPrematchSummary } from "#src/betting/prematch-line.ts";
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

/**
 * The one expensive dependency, injectable.
 *
 * Follows the `GenerateMatchReportDependencies` precedent: a test needs to
 * assert that this is *not* called when the game or guild is out of scope, and
 * proving a negative needs a seam. Module mocking would not do — Bun's
 * `mock.module` is process-wide and would replace this module for every other
 * test file too.
 */
export type PrematchHookDependencies = {
  buildPrediction: typeof buildPrediction;
};

const defaultDependencies: PrematchHookDependencies = { buildPrediction };

export type BucksPrematchAttachment = {
  /** Guilds that got a pool, and so should see buttons. */
  bettingGuildIds: Set<DiscordGuildId>;
  /** The button rows, or empty when nobody in the game can be bet on. */
  rows: ActionRowBuilder<ButtonBuilder>[];
  /** An interesting prediction line appended to the message content. */
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
    loadingScreenData: LoadingScreenData | undefined;
    detectedAt: Date;
  },
  dependencies: PrematchHookDependencies = defaultDependencies,
): Promise<BucksPrematchAttachment> {
  const matchId = `${input.gameInfo.platformId}_${input.gameInfo.gameId.toString()}`;
  const trackedAliasByPuuid = new Map(
    input.trackedPlayers.map((player) => [
      player.league.leagueAccount.puuid,
      player.alias,
    ]),
  );

  // Cheap, pure checks first. Both of these are why the expensive step below is
  // affordable: the prematch poll runs every 30 seconds across up to 50 players,
  // and buildPrediction costs a DuckDB lake read. Computing one for a queue that
  // cannot carry a market, or for guilds that are not on the allowlist, is work
  // nobody will ever see.
  const enabledGuilds = bettingEnabledGuilds(input.targetGuildIds);
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

  const subject = input.trackedPlayers[0];
  const prediction =
    subject === undefined || input.loadingScreenData === undefined
      ? undefined
      : await dependencies.buildPrediction({
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
    guildIds: enabledGuilds,
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

  const footer = bucksPrematchSummary({
    prediction,
    poolState: "open",
    positions: [],
  });

  return { bettingGuildIds, rows, footer, matchId };
}
