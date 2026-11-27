import { divisionToString, type Rank } from "@scout-for-lol/data";
import {
  SCOUT_RANKS,
  type ScoutRank,
} from "@scout-for-lol/design-system/assets";

/** Master and above have no divisions: "Master", not "Master I". */
const APEX: ReadonlySet<ScoutRank> = new Set([
  "Master",
  "Grandmaster",
  "Challenger",
]);

export type RankParts = {
  rank: ScoutRank;
  /** Roman numeral; left out for Master and above. */
  division?: string;
  leaguePoints: number;
};

/** A stored rank as the crest, division and LP the design system draws. */
export function rankParts(rank: Rank): RankParts {
  const crest = SCOUT_RANKS.find(
    (candidate) => candidate.toLowerCase() === rank.tier,
  );
  if (crest === undefined) {
    throw new Error(`No crest exists for rank tier ${rank.tier}`);
  }
  return {
    rank: crest,
    ...(APEX.has(crest) ? {} : { division: divisionToString(rank.division) }),
    leaguePoints: rank.lp,
  };
}

/** "Emerald II", or "Master". */
export function rankName(rank: Rank): string {
  const parts = rankParts(rank);
  return parts.division === undefined
    ? parts.rank
    : `${parts.rank} ${parts.division}`;
}

/** "Emerald II, 64 LP". */
export function rankText(rank: Rank): string {
  return `${rankName(rank)}, ${rank.lp.toString()} LP`;
}
