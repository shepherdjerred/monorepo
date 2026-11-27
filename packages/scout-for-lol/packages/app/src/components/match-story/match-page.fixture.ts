import { RiotMatchIdSchema, type MatchLoadout } from "@scout-for-lol/data";
import type { MatchDetail, MatchStory } from "./match-model.ts";

type Seat = {
  id: number;
  team: 100 | 200;
  champion: string;
  championId: number;
  position: "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY";
  name: string;
  tag: string;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  items: readonly [number, number, number];
  /** A tracked player's id in the viewer's servers. */
  playerId?: number;
  viewer?: boolean;
};

const SEATS: readonly Seat[] = [
  {
    id: 1,
    team: 100,
    champion: "Darius",
    championId: 122,
    position: "TOP",
    name: "Mossback",
    tag: "NA1",
    kills: 5,
    deaths: 4,
    assists: 6,
    damage: 18_400,
    items: [6692, 3071, 3053],
  },
  {
    id: 2,
    team: 100,
    champion: "LeeSin",
    championId: 64,
    position: "JUNGLE",
    name: "Velour",
    tag: "7741",
    kills: 4,
    deaths: 5,
    assists: 12,
    damage: 12_900,
    items: [6692, 3071, 3053],
  },
  {
    id: 3,
    team: 100,
    champion: "Ahri",
    championId: 103,
    position: "MIDDLE",
    name: "Northstar",
    tag: "NA1",
    kills: 9,
    deaths: 2,
    assists: 11,
    damage: 27_600,
    items: [3118, 4645, 3089],
    playerId: 1,
    viewer: true,
  },
  {
    id: 4,
    team: 100,
    champion: "Jinx",
    championId: 222,
    position: "BOTTOM",
    name: "RiverQuartz",
    tag: "NA1",
    kills: 10,
    deaths: 3,
    assists: 9,
    damage: 31_200,
    items: [3031, 3094, 3036],
    playerId: 2,
  },
  {
    id: 5,
    team: 100,
    champion: "Thresh",
    championId: 412,
    position: "UTILITY",
    name: "TidalWren",
    tag: "NA1",
    kills: 1,
    deaths: 4,
    assists: 18,
    damage: 6100,
    items: [3190, 3107, 3109],
    playerId: 3,
  },
  {
    id: 6,
    team: 200,
    champion: "Garen",
    championId: 86,
    position: "TOP",
    name: "Tallowick",
    tag: "NA1",
    kills: 3,
    deaths: 6,
    assists: 4,
    damage: 16_800,
    items: [3068, 3071, 3053],
  },
  {
    id: 7,
    team: 200,
    champion: "Vi",
    championId: 254,
    position: "JUNGLE",
    name: "Ninefold",
    tag: "NA2",
    kills: 4,
    deaths: 6,
    assists: 7,
    damage: 11_200,
    items: [6692, 3071, 3053],
  },
  {
    id: 8,
    team: 200,
    champion: "Yasuo",
    championId: 157,
    position: "MIDDLE",
    name: "Windlass",
    tag: "NA1",
    kills: 5,
    deaths: 7,
    assists: 3,
    damage: 19_500,
    items: [3031, 3036, 3072],
  },
  {
    id: 9,
    team: 200,
    champion: "Kaisa",
    championId: 145,
    position: "BOTTOM",
    name: "Petrichor",
    tag: "RAIN",
    kills: 5,
    deaths: 5,
    assists: 5,
    damage: 22_700,
    items: [6675, 3094, 3036],
  },
  {
    id: 10,
    team: 200,
    champion: "Nautilus",
    championId: 111,
    position: "UTILITY",
    name: "Anchorage",
    tag: "NA1",
    kills: 1,
    deaths: 5,
    assists: 9,
    damage: 5400,
    items: [3190, 3107, 3109],
  },
];

const NOW = Date.parse("2026-11-27T12:00:00Z");
/** The game was played two hours before `NOW`. */
export const MATCH_FIXTURE_NOW = NOW;
export const MATCH_FIXTURE_ID = RiotMatchIdSchema.parse("NA1_5000000001");

export type MatchFixtureOptions = {
  /** The lake holds a timeline for the game. */
  timeline?: boolean;
  remake?: boolean;
  /** The viewer's ranked game left a rank snapshot. */
  lp?: "gain" | "none" | "unknown";
  /** Seat the viewer on the red team, against the fixture's usual blue. */
  viewerOnRed?: boolean;
};

function seatsFor(options: MatchFixtureOptions): readonly Seat[] {
  return options.viewerOnRed === true
    ? SEATS.map((seat) => ({
        ...seat,
        team: seat.team === 100 ? (200 as const) : (100 as const),
      }))
    : SEATS;
}

function loadoutFor(seat: Seat): MatchLoadout {
  return {
    itemIds: [...seat.items, 3020, 1052, 0, 3340],
    summonerSpellIds: [4, 14],
    runes: {
      primaryStyleId: 8100,
      primaryRuneIds: [8112, 8126, 8138, 8135],
      secondaryStyleId: 8200,
      secondaryRuneIds: [8226, 8210],
      statShardIds: { offense: 5008, flex: 5008, defense: 5002 },
    },
  };
}

function participantFor(seat: Seat, options: MatchFixtureOptions) {
  const win = options.remake !== true && seat.team === 100;
  const lpDelta =
    seat.viewer === true && options.lp !== "none" && options.remake !== true
      ? {
          queueType: "solo" as const,
          delta: options.lp === "unknown" ? null : 21,
          rankBefore:
            options.lp === "unknown"
              ? null
              : {
                  division: 2 as const,
                  tier: "emerald" as const,
                  lp: 43,
                  wins: 40,
                  losses: 35,
                },
          rankAfter: {
            division: 2 as const,
            tier: "emerald" as const,
            lp: 64,
            wins: 41,
            losses: 35,
          },
        }
      : null;
  return {
    participantId: seat.id,
    teamId: seat.team,
    subteamId: null,
    placement: null,
    augments: [],
    selectedPlayer: seat.viewer === true,
    riotId: { gameName: seat.name, tagLine: seat.tag },
    championId: seat.championId,
    championName: seat.champion,
    position: seat.position,
    win,
    kills: seat.kills,
    deaths: seat.deaths,
    assists: seat.assists,
    creepScore: 180 + seat.id * 7,
    goldEarned: 10_000 + seat.id * 450,
    visionScore: 12 + seat.id * 3,
    damageToChampions: seat.damage,
    killParticipation: 0.6,
    damageShare: 0.25,
    objectives: { turrets: 1, inhibitors: 0, barons: 0, dragons: 0 },
    loadout: loadoutFor(seat),
    scoutAliases:
      seat.playerId === undefined
        ? []
        : [
            {
              playerId: seat.playerId,
              alias: seat.name,
              guildName: "Rift Study Group",
            },
          ],
    lpDelta,
  };
}

/** `consumerMatch.detail` for the redesigned page, shaped like the endpoint's. */
export function matchDetailFixture(
  options: MatchFixtureOptions = {},
): MatchDetail {
  const timeline = options.timeline ?? true;
  const seats = seatsFor(options);
  const participants = seats.map((seat) => participantFor(seat, options));
  const teams = ([100, 200] as const).map((teamId) => {
    const members = participants.filter((p) => p.teamId === teamId);
    return {
      teamId,
      win: members[0]?.win ?? false,
      participants: members,
      objectives: { turrets: 6, inhibitors: 1, barons: 1, dragons: 2 },
    };
  });
  const viewerSeat = seats.find((seat) => seat.viewer === true);
  const opponentSeat = seats.find(
    (seat) => seat.position === "MIDDLE" && seat.viewer !== true,
  );
  if (viewerSeat === undefined || opponentSeat === undefined) {
    throw new Error("Fixture has no viewer or lane opponent");
  }
  const blueId = viewerSeat.team === 100 ? viewerSeat.id : opponentSeat.id;
  const redId = viewerSeat.team === 100 ? opponentSeat.id : viewerSeat.id;
  // Blue's lead at 15:00; the viewer is up by 640 gold in either seating.
  const blueDelta = viewerSeat.team === 100 ? 640 : -640;
  return {
    match: {
      matchId: MATCH_FIXTURE_ID,
      gameCreationMs: NOW - 2 * 3_600_000,
      gameDurationSeconds: options.remake === true ? 190 : 28 * 60 + 12,
      queue: "solo",
      queueId: 420,
      remake: options.remake === true,
      gameMode: "CLASSIC",
      gameType: "MATCHED_GAME",
      gameVersion: "26.20.1",
      mapId: 11,
      arenaSubteams: null,
      teams,
      roleMatchups:
        timeline && options.remake !== true
          ? [
              {
                role: "middle",
                blueParticipantId: blueId,
                redParticipantId: redId,
                at15: {
                  timestampMs: 900_303,
                  goldDelta: blueDelta,
                  creepScoreDelta: blueDelta > 0 ? 14 : -14,
                  xpDelta: blueDelta > 0 ? 320 : -320,
                },
              },
            ]
          : null,
    },
    timeline: {
      coverage: timeline
        ? {
            coverage_state: "complete",
            data_version: "2",
            frame_interval_ms: 60_000,
            frame_count: 29,
            event_count: 400,
            participant_count: 10,
            first_frame_timestamp_ms: 23,
            last_frame_timestamp_ms: 28 * 60_000 + 23,
          }
        : null,
      keyEvents: [],
    },
  };
}

/** The viewer's lead at each minute: behind early, ahead from minute 9. */
const LEAD_BY_MINUTE = [
  0, 0, 100, -100, -500, -200, 300, 500, 300, -100, -100, 200, 500, 900, 1100,
  1500, 1700, 1600, 2100, 2400, 2900, 3000, 3500, 3700, 4100, 5000, 6200, 7600,
  9200,
] as const;

const MOMENTS: MatchStory["moments"] = [
  {
    id: "first_blood:1",
    kind: "first_blood",
    timestampMs: 192_000,
    teamId: 100,
    players: [],
    count: null,
    opposingCount: null,
    text: "First blood at 3:12 by Northstar",
  },
  {
    id: "dragon:1",
    kind: "dragon",
    timestampMs: 418_000,
    teamId: 200,
    players: [],
    count: null,
    opposingCount: null,
    text: "Dragon at 6:58 by Ninefold",
  },
  {
    id: "multi_kill:1",
    kind: "multi_kill",
    timestampMs: 1_021_000,
    teamId: 100,
    players: [],
    count: 3,
    opposingCount: null,
    text: "Triple kill at 17:01 by RiverQuartz",
  },
  {
    id: "baron:1",
    kind: "baron",
    timestampMs: 1_480_000,
    teamId: 100,
    players: [],
    count: null,
    opposingCount: null,
    text: "Baron at 24:40 by Northstar",
  },
  {
    id: "ace:1",
    kind: "ace",
    timestampMs: 1_500_000,
    teamId: 100,
    players: [],
    count: null,
    opposingCount: null,
    text: "Ace at 25:00 by Velour",
  },
];

const SKILL_ORDER: MatchStory["participants"][number]["skillOrder"] = [
  "Q",
  "W",
  "E",
  "Q",
  "Q",
  "R",
  "Q",
  "W",
  "Q",
  "W",
  "R",
  "W",
  "W",
  "E",
  "E",
  "R",
  "E",
  "E",
];

/** `consumerMatch.story`: the timeline sections, or the end-of-game facts. */
export function matchStoryFixture(
  options: MatchFixtureOptions = {},
): MatchStory {
  const timeline = options.timeline ?? true;
  const seats = seatsFor(options);
  const viewerTeam =
    options.viewerOnRed === true ? (200 as const) : (100 as const);
  return {
    matchId: MATCH_FIXTURE_ID,
    coverage: timeline ? "timeline" : "end_of_game",
    remake: options.remake === true,
    durationSeconds: 28 * 60 + 12,
    winnerTeamId: options.remake === true ? null : 100,
    moments: timeline ? MOMENTS : [],
    goldLead: timeline
      ? {
          teamId: viewerTeam,
          points: LEAD_BY_MINUTE.map((lead, minute) => ({
            timestampMs: minute * 60_000 + 23,
            minute,
            leadGold: viewerTeam === 100 ? lead : -lead,
          })),
        }
      : null,
    participants: seats.map((seat) => ({
      participantId: seat.id,
      teamId: seat.team,
      championId: seat.championId,
      championName: seat.champion,
      displayName: seat.name,
      selectedPlayer: seat.viewer === true,
      finalItemIds: [...seat.items, 3020, 1052],
      buildOrder: timeline
        ? seat.items.map((itemId, index) => ({
            itemId,
            timestampMs: (11 + index * 6) * 60_000,
            minute: 11 + index * 6,
            tier: "legendary" as const,
            soldAtMs: null,
          }))
        : null,
      skillOrder: timeline ? SKILL_ORDER : null,
    })),
    teams: [
      { teamId: 100, win: true, objectives: null },
      { teamId: 200, win: false, objectives: null },
    ],
  };
}
