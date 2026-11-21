import {
  checkLiveGameRecording,
  type DiscordAccountId,
  type LiveGameRecordingPayload,
} from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { DiscordGuildId } from "@scout-for-lol/domain/identity/discord.ts";
import type { LeaguePuuid } from "@scout-for-lol/domain/identity/league-account.ts";
import { prisma } from "#src/database/index.ts";

/** What an end-of-game review reads about the asker, replaceable in tests. */
export type EndOfGameReviewReads = {
  /**
   * The Riot accounts that are the asker's: those they verified with Riot,
   * and those a server they are in tracks as their player (the link Explore
   * already reads "me" from).
   */
  readonly askerPuuids: (input: {
    readonly requesterId: DiscordAccountId;
    readonly guildIds: readonly DiscordGuildId[];
  }) => Promise<ReadonlySet<string>>;
  /**
   * The newest accepted `live_game_recording` the asker's own Scout Desktop
   * uploaded for this game from this Riot account, or null when there is none.
   */
  readonly ownRecording: (input: {
    readonly requesterId: DiscordAccountId;
    readonly matchId: RiotMatchId;
    readonly puuid: LeaguePuuid;
  }) => Promise<LiveGameRecordingPayload | null>;
};

export const endOfGameReviewReads: EndOfGameReviewReads = {
  askerPuuids: async ({ requesterId, guildIds }) => {
    const [verified, tracked] = await Promise.all([
      prisma.riotAccountPreference.findMany({
        where: { ownerDiscordId: requesterId },
        select: { puuid: true },
      }),
      prisma.account.findMany({
        where: {
          player: { discordId: requesterId },
          serverId: { in: [...guildIds] },
        },
        select: { puuid: true },
      }),
    ]);
    return new Set([...verified, ...tracked].map((account) => account.puuid));
  },
  ownRecording: async ({ requesterId, matchId, puuid }) => {
    const [platform, gameId, ...rest] = matchId.split("_");
    if (platform === undefined || gameId === undefined || rest.length > 0)
      throw new Error(`Match ID ${matchId} does not name a platform and game.`);
    const stored = await prisma.scoutClientObservation.findFirst({
      where: {
        kind: "live_game_recording",
        disposition: "ACCEPTED",
        platformId: platform,
        gameId,
        localPuuid: puuid,
        device: { ownerId: requesterId },
      },
      select: { observationId: true, payload: true },
      orderBy: { capturedAt: "desc" },
    });
    if (stored === null) return null;
    // The ingress refused every recording that fails this check, so an
    // accepted row that fails it now is a broken contract, not a user error.
    const check = checkLiveGameRecording(stored.payload);
    if (!check.accepted)
      throw new Error(
        `Accepted live game recording ${stored.observationId} no longer passes its check: ${check.reason}`,
      );
    return check.recording;
  },
};
