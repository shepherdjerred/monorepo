import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import type {
  ComparisonRow,
  IndexChampion,
  MatchupEntry,
} from "#src/lib/champions/champion-pages.ts";

/** Fixture builders for the champion pages' tests and stories. */

export const RIFT_STUDY_GROUP = DiscordGuildIdSchema.parse(
  "1337623164146155593",
);
export const MIDNIGHT_SCRIMS = DiscordGuildIdSchema.parse(
  "1337623164146155594",
);

export function indexChampion(
  overrides: Partial<IndexChampion> = {},
): IndexChampion {
  return {
    championId: 103,
    name: "Ahri",
    games: 40,
    wins: 24,
    winRate: 0.6,
    friendCount: 6,
    lanes: [{ lane: "middle", games: 40 }],
    lastPlayedMs: 0,
    you: null,
    bestFriend: null,
    publicMeta: null,
    ...overrides,
  };
}

export function comparisonRow(
  overrides: Partial<ComparisonRow> = {},
): ComparisonRow {
  return {
    playerId: 1,
    alias: "RiverQuartz",
    guild: { guildId: RIFT_STUDY_GROUP, name: "Rift Study Group" },
    viewerLinked: false,
    games: 34,
    wins: 22,
    losses: 12,
    winRate: 22 / 34,
    last10: [],
    kda: 3,
    csPerMinute: 7,
    damagePerMinute: 700,
    goldPerMinute: 400,
    visionPerMinute: 1,
    ...overrides,
  };
}

export function matchupEntry(
  championId: number,
  name: string,
  you: MatchupEntry["you"],
): MatchupEntry {
  return {
    opponent: { championId, name },
    games: you?.games ?? 0,
    you,
    friends: null,
  };
}

export function matchupTally(
  wins: number,
  games: number,
  ahead: number,
  withFrames: number,
) {
  return { games, wins, ahead15: { games: withFrames, ahead } };
}
