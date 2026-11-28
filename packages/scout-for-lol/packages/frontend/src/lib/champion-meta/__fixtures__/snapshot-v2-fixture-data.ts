import type { MetaRole } from "@scout-for-lol/data/meta/meta-serving.ts";

/** The made-up setups and champions the fixture snapshot is built from. */

export type RuneSetup = {
  primaryStyleId: number;
  primaryPerkIds: number[];
  secondaryStyleId: number;
  secondaryPerkIds: number[];
};

export type RoleSetup = {
  runes: RuneSetup[];
  spells: number[][];
  starting: { itemId: number; count: number }[][];
  skills: string[];
  builds: number[][];
  afterCore: number[];
  boots: number[];
};

export const SETUPS: Record<MetaRole, RoleSetup> = {
  MIDDLE: {
    runes: [
      {
        primaryStyleId: 8100,
        primaryPerkIds: [8112, 8126, 8137, 8106],
        secondaryStyleId: 8200,
        secondaryPerkIds: [8226, 8210],
      },
      {
        primaryStyleId: 8200,
        primaryPerkIds: [8214, 8226, 8210, 8237],
        secondaryStyleId: 8100,
        secondaryPerkIds: [8139, 8135],
      },
      {
        primaryStyleId: 8200,
        primaryPerkIds: [8229, 8226, 8210, 8236],
        secondaryStyleId: 8100,
        secondaryPerkIds: [8126, 8106],
      },
    ],
    spells: [
      [4, 14],
      [4, 12],
      [4, 3],
    ],
    starting: [
      [
        { itemId: 1056, count: 1 },
        { itemId: 2003, count: 2 },
      ],
      [
        { itemId: 1082, count: 1 },
        { itemId: 2003, count: 2 },
      ],
    ],
    skills: ["QWE", "QEW", "WQE"],
    builds: [
      [3118, 4645, 3089],
      [6655, 3020, 3089, 3157],
      [3100, 4645, 3157],
    ],
    afterCore: [3157, 3135, 3102],
    boots: [3020, 3158],
  },
  TOP: {
    runes: [
      {
        primaryStyleId: 8000,
        primaryPerkIds: [8010, 9111, 9104, 8014],
        secondaryStyleId: 8400,
        secondaryPerkIds: [8444, 8451],
      },
      {
        primaryStyleId: 8400,
        primaryPerkIds: [8437, 8463, 8473, 8451],
        secondaryStyleId: 8000,
        secondaryPerkIds: [9111, 8014],
      },
    ],
    spells: [
      [4, 12],
      [4, 14],
    ],
    starting: [
      [
        { itemId: 1055, count: 1 },
        { itemId: 2003, count: 1 },
      ],
      [{ itemId: 1054, count: 1 }],
    ],
    skills: ["QEW", "EQW"],
    builds: [
      [6631, 3047, 3053, 3071],
      [3078, 3047, 3053],
    ],
    afterCore: [3053, 3071, 3742],
    boots: [3047, 3111],
  },
  JUNGLE: {
    runes: [
      {
        primaryStyleId: 8100,
        primaryPerkIds: [8128, 8139, 8137, 8106],
        secondaryStyleId: 8000,
        secondaryPerkIds: [9111, 8014],
      },
      {
        primaryStyleId: 8000,
        primaryPerkIds: [8010, 9111, 9104, 8014],
        secondaryStyleId: 8100,
        secondaryPerkIds: [8139, 8106],
      },
    ],
    spells: [[4, 11]],
    starting: [
      [
        { itemId: 1102, count: 1 },
        { itemId: 2003, count: 1 },
      ],
      [
        { itemId: 1101, count: 1 },
        { itemId: 2003, count: 1 },
      ],
    ],
    skills: ["QWE", "QEW"],
    builds: [
      [6692, 3071, 3053],
      [3074, 3047, 3053],
    ],
    afterCore: [3053, 3742, 3026],
    boots: [3047],
  },
  BOTTOM: {
    runes: [
      {
        primaryStyleId: 8000,
        primaryPerkIds: [8008, 9111, 9103, 8014],
        secondaryStyleId: 8300,
        secondaryPerkIds: [8304, 8347],
      },
      {
        primaryStyleId: 8000,
        primaryPerkIds: [8021, 9111, 9103, 8014],
        secondaryStyleId: 8300,
        secondaryPerkIds: [8304, 8347],
      },
    ],
    spells: [
      [4, 7],
      [4, 14],
    ],
    starting: [
      [
        { itemId: 1055, count: 1 },
        { itemId: 2003, count: 1 },
      ],
    ],
    skills: ["QWE", "QEW"],
    builds: [
      [6672, 3006, 3031],
      [6672, 3006, 3036],
    ],
    afterCore: [3031, 3072, 3036],
    boots: [3006],
  },
  UTILITY: {
    runes: [
      {
        primaryStyleId: 8400,
        primaryPerkIds: [8439, 8463, 8473, 8451],
        secondaryStyleId: 8300,
        secondaryPerkIds: [8304, 8347],
      },
    ],
    spells: [
      [4, 14],
      [4, 3],
    ],
    starting: [
      [
        { itemId: 3865, count: 1 },
        { itemId: 2003, count: 1 },
      ],
    ],
    skills: ["EQW", "QEW"],
    builds: [
      [3190, 3158, 3107],
      [3109, 3158, 3050],
    ],
    afterCore: [3107, 3222, 3109],
    boots: [3158],
  },
};

export type RoleSpec = {
  role: MetaRole;
  games: number;
  winRate: number;
  /** Win-rate change from the shortest to the longest games: negative is an early champion. */
  scaling: number;
};

export type ChampionSpec = { id: number; name: string; roles: RoleSpec[] };

export const CHAMPIONS: ChampionSpec[] = [
  {
    id: 103,
    name: "Ahri",
    roles: [
      { role: "MIDDLE", games: 12_480, winRate: 0.518, scaling: -0.035 },
      { role: "UTILITY", games: 1620, winRate: 0.489, scaling: -0.01 },
    ],
  },
  {
    id: 134,
    name: "Syndra",
    roles: [{ role: "MIDDLE", games: 6400, winRate: 0.502, scaling: 0.03 }],
  },
  {
    id: 61,
    name: "Orianna",
    roles: [{ role: "MIDDLE", games: 7300, winRate: 0.511, scaling: 0.02 }],
  },
  {
    id: 157,
    name: "Yasuo",
    roles: [{ role: "MIDDLE", games: 11_900, winRate: 0.494, scaling: 0.005 }],
  },
  {
    id: 84,
    name: "Akali",
    roles: [{ role: "MIDDLE", games: 6200, winRate: 0.486, scaling: -0.02 }],
  },
  {
    id: 99,
    name: "Lux",
    roles: [
      { role: "UTILITY", games: 8900, winRate: 0.497, scaling: 0.01 },
      { role: "MIDDLE", games: 2100, winRate: 0.505, scaling: 0.015 },
    ],
  },
  {
    id: 86,
    name: "Garen",
    roles: [{ role: "TOP", games: 9100, winRate: 0.506, scaling: -0.01 }],
  },
  {
    id: 122,
    name: "Darius",
    roles: [{ role: "TOP", games: 8700, winRate: 0.499, scaling: -0.025 }],
  },
  {
    id: 875,
    name: "Sett",
    roles: [{ role: "TOP", games: 7800, winRate: 0.503, scaling: 0 }],
  },
  {
    id: 164,
    name: "Camille",
    roles: [{ role: "TOP", games: 5200, winRate: 0.492, scaling: 0.02 }],
  },
  {
    id: 114,
    name: "Fiora",
    roles: [{ role: "TOP", games: 6600, winRate: 0.512, scaling: 0.03 }],
  },
  {
    id: 64,
    name: "Lee Sin",
    roles: [{ role: "JUNGLE", games: 14_100, winRate: 0.512, scaling: -0.03 }],
  },
  {
    id: 254,
    name: "Vi",
    roles: [{ role: "JUNGLE", games: 8200, winRate: 0.507, scaling: -0.005 }],
  },
  {
    id: 234,
    name: "Viego",
    roles: [{ role: "JUNGLE", games: 7100, winRate: 0.496, scaling: 0.02 }],
  },
  {
    id: 141,
    name: "Kayn",
    roles: [{ role: "JUNGLE", games: 6900, winRate: 0.501, scaling: 0.015 }],
  },
  {
    id: 222,
    name: "Jinx",
    roles: [{ role: "BOTTOM", games: 9840, winRate: 0.533, scaling: 0.035 }],
  },
  {
    id: 145,
    name: "Kai'Sa",
    roles: [
      { role: "BOTTOM", games: 13_600, winRate: 0.509, scaling: 0.01 },
      { role: "MIDDLE", games: 940, winRate: 0.471, scaling: 0 },
    ],
  },
  {
    id: 51,
    name: "Caitlyn",
    roles: [{ role: "BOTTOM", games: 10_300, winRate: 0.501, scaling: -0.02 }],
  },
  {
    id: 81,
    name: "Ezreal",
    roles: [{ role: "BOTTOM", games: 12_700, winRate: 0.483, scaling: 0.005 }],
  },
  {
    id: 119,
    name: "Draven",
    roles: [{ role: "BOTTOM", games: 4300, winRate: 0.514, scaling: -0.04 }],
  },
  {
    id: 412,
    name: "Thresh",
    roles: [{ role: "UTILITY", games: 11_200, winRate: 0.53, scaling: 0.005 }],
  },
  {
    id: 89,
    name: "Leona",
    roles: [{ role: "UTILITY", games: 6900, winRate: 0.508, scaling: -0.02 }],
  },
  {
    id: 111,
    name: "Nautilus",
    roles: [{ role: "UTILITY", games: 7600, winRate: 0.498, scaling: -0.005 }],
  },
  {
    id: 53,
    name: "Blitzcrank",
    roles: [{ role: "UTILITY", games: 5400, winRate: 0.491, scaling: -0.025 }],
  },
];
