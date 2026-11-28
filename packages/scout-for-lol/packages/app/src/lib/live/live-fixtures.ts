import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import type {
  LiveGameData,
  LiveListData,
  LiveParticipant,
} from "#src/lib/live/live-game.ts";

/** The moment the fixture lobby was read: six minutes after the game began. */
export const LIVE_NOW = new Date("2026-06-01T20:06:30.000Z");
const STARTED_AT = "2026-06-01T20:00:10.000Z";

type Rank = NonNullable<LiveParticipant["rank"]>;

function rank(
  tier: Rank["tier"],
  division: Rank["division"],
  lp: number,
): Rank {
  return { tier, division, lp, wins: 60, losses: 55 };
}

type Seat = Pick<
  LiveParticipant,
  | "riotId"
  | "teamId"
  | "championId"
  | "lane"
  | "spell1Id"
  | "spell2Id"
  | "keystoneId"
> & {
  rank?: Rank | null;
  friend?: LiveParticipant["friend"];
  recentForm?: LiveParticipant["recentForm"];
};

function seat(input: Seat): LiveParticipant {
  return {
    primaryTreeId: null,
    secondaryTreeId: null,
    rank: null,
    friend: null,
    recentForm: null,
    ...input,
  };
}

const FLASH = 4;
const IGNITE = 14;
const SMITE = 11;
const TELEPORT = 12;
const HEAL = 7;
const GHOST = 6;

const GUILD = DiscordGuildIdSchema.parse("100000000000000051");

export const RIVERQUARTZ = {
  playerId: 7,
  alias: "RiverQuartz",
  guildId: GUILD,
} as const;

/**
 * RiverQuartz on Ahri in mid against Syndra, six minutes in. Their jungler is
 * on a five-game win streak and their Syndra has not played her lately.
 */
export function liveGameFixture(
  overrides: Partial<LiveGameData> = {},
): LiveGameData {
  return {
    riotMatchId: "NA1_5500000777",
    gameId: "5500000777",
    platform: "NA1",
    queueId: 420,
    gameMode: "CLASSIC",
    startedAt: STARTED_AT,
    detectedAt: "2026-06-01T20:00:40.000Z",
    ended: false,
    recentFormComplete: true,
    participants: [
      seat({
        riotId: "Ironbark#NA1",
        teamId: 100,
        championId: 86,
        lane: "top",
        spell1Id: FLASH,
        spell2Id: IGNITE,
        keystoneId: 8010,
        rank: rank("emerald", 3, 40),
      }),
      seat({
        riotId: "Sundial#4410",
        teamId: 100,
        championId: 254,
        lane: "jungle",
        spell1Id: FLASH,
        spell2Id: SMITE,
        keystoneId: 9923,
        rank: rank("emerald", 2, 12),
      }),
      seat({
        riotId: "RiverQuartz#NA1",
        teamId: 100,
        championId: 103,
        lane: "middle",
        spell1Id: FLASH,
        spell2Id: TELEPORT,
        keystoneId: 8112,
        rank: rank("emerald", 1, 22),
        friend: RIVERQUARTZ,
      }),
      seat({
        riotId: "Marigold#NA1",
        teamId: 100,
        championId: 51,
        lane: "adc",
        spell1Id: FLASH,
        spell2Id: HEAL,
        keystoneId: 8021,
        rank: rank("emerald", 2, 60),
      }),
      seat({
        riotId: "Tumbledown#NA1",
        teamId: 100,
        championId: 89,
        lane: "support",
        spell1Id: FLASH,
        spell2Id: IGNITE,
        keystoneId: 8439,
        rank: rank("platinum", 1, 90),
      }),
      seat({
        riotId: "Cinderpaw#NA1",
        teamId: 200,
        championId: 122,
        lane: "top",
        spell1Id: FLASH,
        spell2Id: GHOST,
        keystoneId: 8010,
        recentForm: fetchedForm({ games: 5, wins: 3, onChampion: [2, 1] }),
      }),
      seat({
        riotId: "Hushwing#OWL",
        teamId: 200,
        championId: 234,
        lane: "jungle",
        spell1Id: FLASH,
        spell2Id: SMITE,
        keystoneId: 8010,
        recentForm: fetchedForm({
          games: 5,
          wins: 5,
          streak: 5,
          onChampion: [4, 3],
          rank: rank("emerald", 1, 75),
        }),
      }),
      seat({
        riotId: "Lowtide#NA1",
        teamId: 200,
        championId: 134,
        lane: "middle",
        spell1Id: FLASH,
        spell2Id: IGNITE,
        keystoneId: 8369,
        recentForm: fetchedForm({
          games: 5,
          wins: 2,
          onChampion: [0, 0],
          rank: rank("emerald", 3, 10),
        }),
      }),
      seat({
        riotId: "Brassfinch#NA1",
        teamId: 200,
        championId: 81,
        lane: "adc",
        spell1Id: FLASH,
        spell2Id: HEAL,
        keystoneId: 8005,
        recentForm: { status: "unavailable", recordedAt: STARTED_AT },
      }),
      seat({
        riotId: "Oddfellow#NA1",
        teamId: 200,
        championId: 111,
        lane: "support",
        spell1Id: FLASH,
        spell2Id: IGNITE,
        keystoneId: 8439,
        recentForm: null,
      }),
    ],
    ...overrides,
  };
}

function fetchedForm(input: {
  games: number;
  wins: number;
  streak?: number;
  /** Games on the champion, and the wins among them. */
  onChampion: readonly [number, number];
  rank?: Rank;
}): LiveParticipant["recentForm"] {
  return {
    status: "fetched",
    games: input.games,
    wins: input.wins,
    streak:
      input.streak === undefined
        ? null
        : { result: "win", length: input.streak },
    gamesOnChampion: input.onChampion[0],
    winsOnChampion: input.onChampion[1],
    rank: input.rank ?? null,
    fetchedAt: STARTED_AT,
  };
}

/** The same lobby with a second friend, Quillon, in the top lane beside RiverQuartz. */
export function twoFriendsFixture(): LiveGameData {
  const game = liveGameFixture();
  return {
    ...game,
    participants: game.participants.map((participant, index) =>
      index === 0
        ? {
            ...participant,
            friend: {
              playerId: 8,
              alias: "Quillon",
              guildId: GUILD,
            },
          }
        : participant,
    ),
  };
}

export function liveListFixture(): LiveListData {
  return [
    {
      riotMatchId: "NA1_5500000777",
      gameId: "5500000777",
      platform: "NA1",
      queueId: 420,
      startedAt: STARTED_AT,
      detectedAt: "2026-06-01T20:00:40.000Z",
      friends: [{ ...RIVERQUARTZ, championId: 103, lane: "middle" }],
    },
    {
      riotMatchId: "NA1_5500000778",
      gameId: "5500000778",
      platform: "NA1",
      queueId: 450,
      startedAt: null,
      detectedAt: "2026-06-01T20:05:00.000Z",
      friends: [
        {
          playerId: 8,
          alias: "Quillon",
          guildId: GUILD,
          championId: 222,
          lane: null,
        },
        {
          playerId: 9,
          alias: "Halcyon",
          guildId: GUILD,
          championId: 40,
          lane: null,
        },
      ],
    },
  ];
}
