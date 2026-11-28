import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type {
  DiscordAccountId,
  DiscordGuildId,
  LeaguePuuid,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { seedConsumerPlayer } from "#src/testing/consumer-player-seed.ts";
import { testPuuid } from "#src/testing/test-ids.ts";
import { writeTestLake } from "#src/testing/report-lake/test-report-lake.ts";
import {
  championLobby,
  type LobbySeat,
  type LobbyTimeline,
} from "#src/testing/report-lake/champion-lobbies.ts";
import type { TestLakeMatchFact } from "#src/testing/report-lake/rows.ts";

/**
 * The champion-page test group: a viewer with two accounts, two friends and
 * the viewer's third account on a second server, with the games the champion
 * pages are tested on.
 */

export const VIEWER_MAIN = testPuuid("champion-viewer-main");
export const VIEWER_ALT = testPuuid("champion-viewer-alt");
export const VIEWER_OTHER_GUILD = testPuuid("champion-viewer-other-guild");
export const RIVER = testPuuid("champion-river");
export const TIDAL = testPuuid("champion-tidal");
export const HOURS = 3_600_000;
export const NOW = Date.now();

export const AHRI = { id: 103, name: "Ahri" };
export const SYNDRA = { id: 134, name: "Syndra" };
export const YASUO = { id: 157, name: "Yasuo" };
export const GAREN = { id: 86, name: "Garen" };
export const JINX = { id: 222, name: "Jinx" };

export function matchId(n: number): RiotMatchId {
  return RiotMatchIdSchema.parse(`NA1_${(8_800_000_000 + n).toString()}`);
}

type Seat = {
  who: LeaguePuuid | null;
  team: 100 | 200;
  position: LobbySeat["position"];
  champion: { id: number; name: string };
  gold15: number;
  build?: LobbySeat["build"];
};

const POSITIONS: LobbySeat["position"][] = [
  "TOP",
  "JUNGLE",
  "MIDDLE",
  "BOTTOM",
  "UTILITY",
];

/** The named seats, with a stranger in each of the other roles. */
export function lobby(options: {
  n: number;
  hoursAgo: number;
  winner: 100 | 200;
  seats: Seat[];
  timeline?: LobbyTimeline;
}) {
  const seats: LobbySeat[] = [];
  for (const team of [100, 200] as const) {
    for (const position of POSITIONS) {
      const named = options.seats.find(
        (seat) => seat.team === team && seat.position === position,
      );
      const index = seats.length + 1;
      const who = named?.who ?? null;
      seats.push({
        playerId: options.n * 100 + index,
        alias:
          who === null
            ? `Stranger ${index.toString()}`
            : `Tracked ${index.toString()}`,
        puuid:
          who ??
          testPuuid(`stranger-${options.n.toString()}-${index.toString()}`),
        tracked: who !== null,
        teamId: team,
        position,
        championId: named?.champion.id ?? 1,
        championName: named?.champion.name ?? "Annie",
        gold15: named?.gold15 ?? 5000,
        ...(named?.build === undefined ? {} : { build: named.build }),
      });
    }
  }
  return championLobby({
    matchId: matchId(options.n),
    createdAt: new Date(NOW - options.hoursAgo * HOURS),
    winningTeam: options.winner,
    seats,
    ...(options.timeline === undefined ? {} : { timeline: options.timeline }),
  });
}

/** A one-player game, for rosters the champion index alone reads. */
export function soloGame(options: {
  n: number;
  hoursAgo: number;
  puuid: LeaguePuuid;
  champion: { id: number; name: string };
  win?: boolean;
}): TestLakeMatchFact {
  return {
    playerId: options.n,
    playerAlias: "Solo",
    matchId: matchId(options.n),
    puuid: options.puuid,
    queue: "solo",
    win: options.win ?? true,
    surrendered: false,
    kills: 4,
    deaths: 2,
    assists: 6,
    teamId: 100,
    teamPosition: "MIDDLE",
    championId: options.champion.id,
    championName: options.champion.name,
    gameCreationAt: new Date(NOW - options.hoursAgo * HOURS),
  };
}

export async function writeLobbies(
  lakeDir: string,
  guilds: { guildId: DiscordGuildId; otherGuildId: DiscordGuildId },
  lobbies: ReturnType<typeof lobby>[],
  extra: TestLakeMatchFact[] = [],
) {
  await writeTestLake(lakeDir, {
    serverId: guilds.guildId,
    alsoTrackedBy: [guilds.otherGuildId],
    matchFacts: [...lobbies.flatMap((entry) => entry.tracked), ...extra],
    untrackedMatchFacts: lobbies.flatMap((entry) => entry.untracked),
    timelineFrames: lobbies.flatMap((entry) => entry.timelineFrames),
    timelineEvents: lobbies.flatMap((entry) => entry.timelineEvents),
  });
}

/**
 * The viewer (two accounts) and two friends in `guildId`; the viewer's third
 * account sits on a second player in `otherGuildId`.
 */
export async function seedGroup(
  testPrisma: ExtendedPrismaClient,
  scope: {
    guildId: DiscordGuildId;
    otherGuildId: DiscordGuildId;
    viewerDiscordId: DiscordAccountId;
  },
) {
  const { guildId, otherGuildId, viewerDiscordId } = scope;
  const seedPlayer_ = (options: Parameters<typeof seedConsumerPlayer>[2]) =>
    seedConsumerPlayer(testPrisma, viewerDiscordId, options);
  const viewer = await seedPlayer_({
    serverId: guildId,
    alias: "Northstar",
    discordId: viewerDiscordId,
    puuids: [VIEWER_MAIN, VIEWER_ALT],
  });
  const river = await seedPlayer_({
    serverId: guildId,
    alias: "RiverQuartz",
    puuids: [RIVER],
  });
  const tidal = await seedPlayer_({
    serverId: guildId,
    alias: "TidalWren",
    puuids: [TIDAL],
  });
  const viewerElsewhere = await seedPlayer_({
    serverId: otherGuildId,
    alias: "Northstar Elsewhere",
    discordId: viewerDiscordId,
    puuids: [VIEWER_OTHER_GUILD],
  });
  return { viewer, river, tidal, viewerElsewhere };
}

export const mid = (
  who: LeaguePuuid | null,
  team: 100 | 200,
  champion: { id: number; name: string },
  gold15: number,
): Seat => ({ who, team, position: "MIDDLE", champion, gold15 });

/**
 * Ahri in mid, newest first:
 * 1h viewer (main) beats Syndra, ahead; 2h viewer (alt) loses to Syndra,
 * behind; 3h River wins into Yasuo, ahead; 4h River loses into Yasuo with no
 * timeline; 5h Tidal plays Ahri top; 6h the viewer's Jinx; 7h viewer wins into
 * Syndra in a game that ended before 15:00.
 */
export function groupGames() {
  return [
    lobby({
      n: 1,
      hoursAgo: 1,
      winner: 100,
      seats: [mid(VIEWER_MAIN, 100, AHRI, 6000), mid(null, 200, SYNDRA, 5000)],
    }),
    lobby({
      n: 2,
      hoursAgo: 2,
      winner: 200,
      seats: [mid(VIEWER_ALT, 100, AHRI, 5000), mid(null, 200, SYNDRA, 5500)],
    }),
    lobby({
      n: 3,
      hoursAgo: 3,
      winner: 200,
      seats: [mid(null, 100, YASUO, 5000), mid(RIVER, 200, AHRI, 6000)],
    }),
    lobby({
      n: 4,
      hoursAgo: 4,
      winner: 200,
      timeline: "none",
      seats: [mid(RIVER, 100, AHRI, 5000), mid(null, 200, YASUO, 5000)],
    }),
    lobby({
      n: 5,
      hoursAgo: 5,
      winner: 100,
      seats: [
        {
          who: TIDAL,
          team: 100,
          position: "TOP",
          champion: AHRI,
          gold15: 5200,
        },
        {
          who: null,
          team: 200,
          position: "TOP",
          champion: GAREN,
          gold15: 5000,
        },
      ],
    }),
    lobby({
      n: 6,
      hoursAgo: 6,
      winner: 100,
      seats: [
        {
          who: VIEWER_MAIN,
          team: 100,
          position: "BOTTOM",
          champion: JINX,
          gold15: 5000,
        },
      ],
    }),
    lobby({
      n: 7,
      hoursAgo: 7,
      winner: 100,
      timeline: "ended-before-15",
      seats: [mid(VIEWER_MAIN, 100, AHRI, 5000), mid(null, 200, SYNDRA, 5000)],
    }),
    lobby({
      n: 8,
      hoursAgo: 8,
      winner: 100,
      seats: [
        mid(VIEWER_OTHER_GUILD, 100, AHRI, 6500),
        mid(null, 200, SYNDRA, 5000),
      ],
    }),
  ];
}
