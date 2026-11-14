import {
  getClassicSpellId,
  isClassicAssetMode,
  resolveClassicChampionKey,
  type MatchLoadout,
} from "@scout-for-lol/data";
import { matchLoadoutFromLakeRow } from "#src/report-lake/loadout.ts";
import type { LakeMatchParticipantRow } from "#src/reports/duckdb/consumer/profile-lake-reads.ts";

type OrderableRow = Pick<
  LakeMatchParticipantRow,
  "team_id" | "participant_id" | "champion_id" | "champion_name"
>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Roster order for a match view: by team, then participant id. An end-of-game
 * record numbers no participant, so those rows fall back to champion, which
 * is stable and states nothing the record does not.
 */
export function orderMatchRows<T extends OrderableRow>(
  rows: readonly T[],
): T[] {
  return rows.toSorted((left, right) => {
    if (left.team_id !== right.team_id) return left.team_id - right.team_id;
    if (left.participant_id !== null && right.participant_id !== null) {
      return left.participant_id - right.participant_id;
    }
    if (left.participant_id !== null || right.participant_id !== null) {
      return left.participant_id === null ? 1 : -1;
    }
    return (
      compareText(left.champion_name, right.champion_name) ||
      left.champion_id - right.champion_id
    );
  });
}

function isClassicRow(row: LakeMatchParticipantRow): boolean {
  return isClassicAssetMode(row.queue_id, row.game_mode);
}

/**
 * The Data Dragon asset key a row's champion icon resolves through. A Classic
 * row goes through the Classic catalog by id, which fails loudly on an id the
 * catalog does not know rather than guessing an icon.
 */
export function matchRowChampionName(row: LakeMatchParticipantRow): string {
  return isClassicRow(row)
    ? resolveClassicChampionKey(row.champion_id)
    : row.champion_name;
}

/** The row's loadout, with Classic summoner spells on their Classic ids. */
export function matchRowLoadout(row: LakeMatchParticipantRow): MatchLoadout {
  const loadout = matchLoadoutFromLakeRow(row);
  if (!isClassicRow(row)) return loadout;
  const [first, second] = loadout.summonerSpellIds;
  return {
    ...loadout,
    summonerSpellIds: [getClassicSpellId(first), getClassicSpellId(second)],
  };
}
