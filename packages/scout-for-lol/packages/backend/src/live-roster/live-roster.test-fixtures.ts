import {
  RawCurrentGameInfoSchema,
  type PlayerConfigEntry,
  type RawCurrentGameInfo,
} from "@scout-for-lol/data";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { testPuuid } from "#src/testing/test-ids.ts";
import type { ScoutPrematchContext } from "#src/temporal/prematch/prematch-context.ts";

/**
 * A ranked Summoner's Rift lobby, ten players: top Garen, jungle Vi, mid Ahri,
 * bot Caitlyn and support Leona against Darius, Viego, Syndra, Ezreal and
 * Nautilus. Seat 2 (Ahri) is the first tracked friend unless told otherwise.
 */
export const LIVE_GAME_ID = 5_500_000_777;
export const LIVE_MATCH_ID = RiotMatchIdSchema.parse(
  `NA1_${LIVE_GAME_ID.toString()}`,
);

const SEATS = [
  { championId: 86, name: "Ironbark", spells: [4, 12] },
  { championId: 254, name: "Sundial", spells: [4, 11] },
  { championId: 103, name: "RiverQuartz", spells: [4, 12] },
  { championId: 51, name: "Marigold", spells: [4, 7] },
  { championId: 89, name: "Tumbledown", spells: [4, 14] },
  { championId: 122, name: "Cinderpaw", spells: [4, 6] },
  { championId: 234, name: "Hushwing", spells: [4, 11] },
  { championId: 134, name: "Lowtide", spells: [4, 14] },
  { championId: 81, name: "Brassfinch", spells: [4, 7] },
  { championId: 111, name: "Oddfellow", spells: [4, 14] },
] as const;

/** The PUUID of one seat; stable across tests. */
export function seatPuuid(seat: number) {
  return testPuuid(`live-seat-${seat.toString()}`);
}

export function liveGameFixture(
  overrides: { hiddenSeats?: readonly number[]; gameStartTime?: number } = {},
): RawCurrentGameInfo {
  return RawCurrentGameInfoSchema.parse({
    gameId: LIVE_GAME_ID,
    gameStartTime: overrides.gameStartTime ?? 1_780_000_000_000,
    gameMode: "CLASSIC",
    mapId: 11,
    gameType: "MATCHED_GAME",
    gameQueueConfigId: 420,
    gameLength: 360,
    platformId: "NA1",
    bannedChampions: [],
    participants: SEATS.map((seat, index) => {
      const hidden = overrides.hiddenSeats?.includes(index) === true;
      return {
        championId: seat.championId,
        puuid: hidden ? null : seatPuuid(index),
        teamId: index < 5 ? 100 : 200,
        riotId: hidden ? "Hidden" : `${seat.name}#NA1`,
        spell1Id: seat.spells[0],
        spell2Id: seat.spells[1],
        lastSelectedSkinIndex: 0,
        bot: false,
        profileIconId: 1,
        perks: {
          perkIds: [8112 + index, 8139, 8138, 8135, 8226, 8210],
          perkStyle: 8100,
          perkSubStyle: 8200,
        },
      };
    }),
  });
}

/** A tracked account as the prematch capture resolves it. */
export function trackedPlayer(seat: number): PlayerConfigEntry {
  return {
    alias: `tracked-${seat.toString()}`,
    league: {
      leagueAccount: {
        puuid: LeaguePuuidSchema.parse(seatPuuid(seat)),
        region: "AMERICA_NORTH",
      },
    },
  };
}

export function liveContext(
  trackedSeats: readonly number[],
  game: RawCurrentGameInfo = liveGameFixture(),
): ScoutPrematchContext {
  return {
    riotMatchId: LIVE_MATCH_ID,
    gameInfo: game,
    trackedPlayers: trackedSeats.map((seat) => trackedPlayer(seat)),
  };
}
