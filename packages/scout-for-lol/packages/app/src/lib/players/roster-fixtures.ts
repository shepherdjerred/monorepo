import { DiscordGuildIdSchema, PlayerIdSchema } from "@scout-for-lol/data";
import {
  matchId,
  NOW_MS,
  RIFT_STUDY_GROUP,
} from "#src/lib/player/player-fixtures.ts";
import type { Roster, RosterPlayer } from "#src/lib/players/roster-page.ts";

/** Fixture builders for the Players page's tests and stories. */

export const MIDNIGHT_SCRIMS = DiscordGuildIdSchema.parse(
  "1337623164146155594",
);

export const GUILDS: Roster["guilds"] = [
  { id: MIDNIGHT_SCRIMS, name: "Midnight Scrims" },
  { id: RIFT_STUDY_GROUP, name: "Rift Study Group" },
];

export function rosterPlayer(
  playerId: number,
  alias: string,
  overrides: Partial<RosterPlayer> = {},
): RosterPlayer {
  const [guild] = GUILDS.slice(1);
  if (guild === undefined) throw new Error("The fixtures have no guild");
  const id = PlayerIdSchema.parse(playerId);
  return {
    playerId: id,
    alias,
    isYou: false,
    accountCount: 1,
    memberships: [{ playerId: id, guild }],
    rank: {
      solo: { tier: "platinum", division: 1, lp: 80, wins: 50, losses: 40 },
      flex: null,
    },
    latestGame: {
      matchId: matchId(playerId),
      win: false,
      championId: 412,
      championName: "Thresh",
      queue: "solo",
      queueId: 420,
      gameCreationMs: NOW_MS - 2 * 3_600_000,
    },
    live: null,
    lastSevenDays: { games: 6 },
    form: { games: 20, wins: 12, streak: null },
    ...overrides,
  };
}

/** Someone in a Ranked Solo game as Ahri, detected five minutes before `NOW_MS`. */
export const LIVE_GAME: NonNullable<RosterPlayer["live"]> = {
  gameId: "5000",
  queueId: 420,
  championId: 103,
  detectedAt: new Date(NOW_MS - 5 * 60_000).toISOString(),
};
