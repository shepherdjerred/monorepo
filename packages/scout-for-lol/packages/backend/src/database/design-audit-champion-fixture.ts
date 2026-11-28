import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import {
  LeaguePuuidSchema,
  type DiscordAccountId,
  type DiscordGuildId,
  type LeaguePuuid,
  type Region,
} from "@scout-for-lol/data";
import type { PrismaClient } from "#generated/prisma/client/index.js";
import {
  championLobby,
  type LobbyPosition,
  type LobbySeat,
} from "#src/testing/report-lake/champion-lobbies.ts";

/**
 * Friends who play the champions the redesigned champion pages show: Ahri in
 * mid with a spread of lane results against Yasuo, Syndra and Lux, and a few
 * off-role games, so the index, the ranking and the matchups all have rows.
 */

const AHRI = { id: 103, name: "Ahri" };
const JINX = { id: 222, name: "Jinx" };
const YASUO = { id: 157, name: "Yasuo" };
const SYNDRA = { id: 134, name: "Syndra" };
const LUX = { id: 99, name: "Lux" };
const AKALI = { id: 84, name: "Akali" };
type Champion = { id: number; name: string };

const FRIENDS = [
  { alias: "Quillon", puuid: "q", riotGameName: "Quillon", tag: "QRTZ" },
  { alias: "Halcyon", puuid: "r", riotGameName: "Halcyon", tag: "HLCN" },
  { alias: "TidalWren", puuid: "s", riotGameName: "TidalWren", tag: "TIDE" },
] as const;

type Friend = (typeof FRIENDS)[number]["alias"];

/** One Ahri mid game: the opponent, the result and whether Ahri led at 15:00. */
type AhriGame = readonly [
  who: "viewer" | Friend,
  opponent: Champion,
  won: boolean,
  led: boolean | null,
];

const AHRI_GAMES: readonly AhriGame[] = [
  ...Array.from({ length: 5 }, (): AhriGame => ["viewer", YASUO, true, true]),
  ["viewer", YASUO, false, false],
  ["viewer", SYNDRA, true, true],
  ...Array.from({ length: 4 }, (): AhriGame => [
    "viewer",
    SYNDRA,
    false,
    false,
  ]),
  ...Array.from({ length: 3 }, (): AhriGame => ["viewer", LUX, true, true]),
  ["viewer", LUX, false, false],
  ["Quillon", YASUO, true, true],
  ["Quillon", SYNDRA, false, false],
  ["Quillon", AKALI, false, true],
  ["Quillon", LUX, true, true],
  ["Quillon", YASUO, true, null],
  ["Quillon", SYNDRA, true, null],
  ["Halcyon", YASUO, true, true],
  ["Halcyon", AKALI, false, false],
  ["Halcyon", SYNDRA, false, false],
  ["Halcyon", LUX, true, true],
  ["TidalWren", YASUO, false, false],
  ["TidalWren", SYNDRA, true, true],
  ["TidalWren", LUX, false, null],
];

function friendPuuid(seed: string): LeaguePuuid {
  return LeaguePuuidSchema.parse(`friend-${seed}`.padEnd(78, "x"));
}

/** The friends, as players with one account each, in the viewer's guild. */
export async function seedDesignAuditChampionFriends(input: {
  prisma: PrismaClient;
  guildId: DiscordGuildId;
  creatorDiscordId: DiscordAccountId;
  region: Region;
  now: Date;
}) {
  const players: { alias: Friend; playerId: number; puuid: LeaguePuuid }[] = [];
  for (const friend of FRIENDS) {
    const player = await input.prisma.player.create({
      data: {
        serverId: input.guildId,
        alias: friend.alias,
        creatorDiscordId: input.creatorDiscordId,
        createdTime: input.now,
        updatedTime: input.now,
      },
    });
    const puuid = friendPuuid(friend.puuid);
    await input.prisma.account.create({
      data: {
        alias: friend.alias,
        puuid,
        region: input.region,
        playerId: player.id,
        serverId: input.guildId,
        riotGameName: friend.riotGameName,
        riotTagLine: friend.tag,
        riotIdUpdatedAt: input.now,
        lastMatchTime: input.now,
        lastCheckedAt: input.now,
        creatorDiscordId: input.creatorDiscordId,
        createdTime: input.now,
        updatedTime: input.now,
      },
    });
    players.push({ alias: friend.alias, playerId: player.id, puuid });
  }
  return players;
}

function seat(options: {
  playerId: number;
  alias: string;
  puuid: LeaguePuuid;
  discordId?: DiscordAccountId;
  tracked: boolean;
  teamId: 100 | 200;
  position: LobbyPosition;
  champion: Champion;
  gold15: number;
}): LobbySeat {
  return {
    playerId: options.playerId,
    alias: options.alias,
    puuid: options.puuid,
    ...(options.discordId === undefined
      ? {}
      : { discordId: options.discordId }),
    tracked: options.tracked,
    teamId: options.teamId,
    position: options.position,
    championId: options.champion.id,
    championName: options.champion.name,
    gold15: options.gold15,
  };
}

const POSITIONS: LobbyPosition[] = [
  "TOP",
  "JUNGLE",
  "MIDDLE",
  "BOTTOM",
  "UTILITY",
];

/** A stranger in a seat nobody on the page looks at. */
function strangerSeat(options: {
  base: number;
  teamId: 100 | 200;
  position: LobbyPosition;
  champion: Champion;
  gold15: number;
  label: string;
}): LobbySeat {
  return seat({
    playerId: options.base,
    alias: `${options.label} ${options.base.toString()}`,
    puuid: LeaguePuuidSchema.parse(
      `${options.label.toLowerCase()}-${options.base.toString()}`.padEnd(
        78,
        "x",
      ),
    ),
    tracked: false,
    teamId: options.teamId,
    position: options.position,
    champion: options.champion,
    gold15: options.gold15,
  });
}

/** Ten seats: Ahri in blue mid against `opponent`, strangers everywhere else. */
function ahriLobbySeats(options: {
  index: number;
  ahri: {
    playerId: number;
    alias: string;
    puuid: LeaguePuuid;
    discordId?: DiscordAccountId;
  };
  opponent: Champion;
  led: boolean | null;
}): LobbySeat[] {
  const seats: LobbySeat[] = [];
  for (const teamId of [100, 200] as const) {
    for (const position of POSITIONS) {
      const base = 9500 + options.index * 10 + seats.length + 1;
      if (position !== "MIDDLE") {
        seats.push(
          strangerSeat({
            base,
            teamId,
            position,
            champion: JINX,
            gold15: 5500,
            label: "Player",
          }),
        );
        continue;
      }
      seats.push(midSeat(options, teamId, base));
    }
  }
  return seats;
}

/** Ahri leads at 15:00 unless the game says she did not. */
function midSeat(
  options: Parameters<typeof ahriLobbySeats>[0],
  teamId: 100 | 200,
  base: number,
): LobbySeat {
  const behind = options.led === false;
  if (teamId === 100) {
    return seat({
      ...options.ahri,
      tracked: true,
      teamId,
      position: "MIDDLE",
      champion: AHRI,
      gold15: behind ? 5000 : 6000,
    });
  }
  return strangerSeat({
    base,
    teamId,
    position: "MIDDLE",
    champion: options.opponent,
    gold15: behind ? 6000 : 5000,
    label: "Opponent",
  });
}

/** The lake rows for every game above, as ten-player lobbies with timelines. */
export function designAuditChampionGames(input: {
  viewer: {
    playerId: number;
    alias: string;
    puuid: LeaguePuuid;
    discordId: DiscordAccountId;
  };
  friends: { alias: Friend; playerId: number; puuid: LeaguePuuid }[];
}) {
  const tracked = [];
  const untracked = [];
  const timelineFrames = [];
  for (const [index, [who, opponent, won, led]] of AHRI_GAMES.entries()) {
    const person =
      who === "viewer"
        ? input.viewer
        : input.friends.find((friend) => friend.alias === who);
    if (person === undefined) {
      throw new Error(`Design-audit friend ${who} was not seeded`);
    }
    const lobby = championLobby({
      matchId: RiotMatchIdSchema.parse(
        `NA1_${(9_400_000_000 + index).toString()}`,
      ),
      // Just before the audit's newest game, so they fill a 20-game window.
      createdAt: new Date(Date.UTC(2026, 0, 1, 11) - index * 3_600_000),
      winningTeam: won ? 100 : 200,
      seats: ahriLobbySeats({
        index,
        ahri: {
          ...person,
          ...(who === "viewer" ? { discordId: input.viewer.discordId } : {}),
        },
        opponent,
        led,
      }),
      timeline: led === null ? "none" : "full",
    });
    tracked.push(...lobby.tracked);
    untracked.push(...lobby.untracked);
    timelineFrames.push(...lobby.timelineFrames);
  }
  return { tracked, untracked, timelineFrames };
}
