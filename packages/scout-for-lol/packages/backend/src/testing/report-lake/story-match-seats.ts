/**
 * The players and the gold curve of the story fixture: a ranked Summoner's Rift
 * game won by the blue team. Participants are numbered 1 to 10; the viewer is
 * participant 3 (blue mid).
 */

export type StorySeat = {
  participantId: number;
  teamId: number;
  riotId: string;
  championId: number;
  championName: string;
  position: string;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  /** Legendary items bought around minutes 11, 18 and 24. */
  core: readonly [number, number, number];
};

export const STORY_VIEWER_PARTICIPANT_ID = 3;
export const STORY_DURATION_MINUTES = 28;

export const STORY_SEATS: readonly StorySeat[] = [
  {
    participantId: 1,
    teamId: 100,
    riotId: "Mossback",
    championId: 122,
    championName: "Darius",
    position: "TOP",
    kills: 5,
    deaths: 4,
    assists: 6,
    damage: 18_400,
    core: [6692, 3071, 3053],
  },
  {
    participantId: 2,
    teamId: 100,
    riotId: "Velour",
    championId: 64,
    championName: "LeeSin",
    position: "JUNGLE",
    kills: 4,
    deaths: 5,
    assists: 12,
    damage: 12_900,
    core: [6692, 3071, 3053],
  },
  {
    participantId: 3,
    teamId: 100,
    riotId: "Viewer",
    championId: 103,
    championName: "Ahri",
    position: "MIDDLE",
    kills: 9,
    deaths: 2,
    assists: 11,
    damage: 27_600,
    core: [3118, 4645, 3089],
  },
  {
    participantId: 4,
    teamId: 100,
    riotId: "RiverQuartz",
    championId: 222,
    championName: "Jinx",
    position: "BOTTOM",
    kills: 10,
    deaths: 3,
    assists: 9,
    damage: 31_200,
    core: [3031, 3094, 3036],
  },
  {
    participantId: 5,
    teamId: 100,
    riotId: "TidalWren",
    championId: 412,
    championName: "Thresh",
    position: "UTILITY",
    kills: 1,
    deaths: 4,
    assists: 18,
    damage: 6100,
    core: [3109, 3107, 3050],
  },
  {
    participantId: 6,
    teamId: 200,
    riotId: "Tallowick",
    championId: 86,
    championName: "Garen",
    position: "TOP",
    kills: 3,
    deaths: 6,
    assists: 4,
    damage: 16_800,
    core: [6630, 3071, 3053],
  },
  {
    participantId: 7,
    teamId: 200,
    riotId: "Ninefold",
    championId: 254,
    championName: "Vi",
    position: "JUNGLE",
    kills: 4,
    deaths: 6,
    assists: 7,
    damage: 11_200,
    core: [6692, 3071, 3053],
  },
  {
    participantId: 8,
    teamId: 200,
    riotId: "Windlass",
    championId: 157,
    championName: "Yasuo",
    position: "MIDDLE",
    kills: 5,
    deaths: 7,
    assists: 3,
    damage: 19_500,
    core: [6673, 3031, 3036],
  },
  {
    participantId: 9,
    teamId: 200,
    riotId: "Petrichor",
    championId: 145,
    championName: "Kaisa",
    position: "BOTTOM",
    kills: 5,
    deaths: 5,
    assists: 5,
    damage: 22_700,
    core: [3031, 3094, 3036],
  },
  {
    participantId: 10,
    teamId: 200,
    riotId: "Anchorage",
    championId: 111,
    championName: "Nautilus",
    position: "UTILITY",
    kills: 1,
    deaths: 5,
    assists: 9,
    damage: 5400,
    core: [3109, 3107, 3050],
  },
];

/** The blue team's total-gold lead at each minute, 0 to 28. */
export const STORY_GOLD_LEAD_BY_MINUTE: readonly number[] = [
  0, 0, 120, 60, -80, -150, -310, -500, -240, 160, 420, 700, 980, 1250, 1500,
  1900, 2100, 2300, 2650, 2900, 3100, 3300, 3600, 3900, 4100, 4900, 6200, 7800,
  9200,
];
