import type { ReactNode } from "react";
import type { ScoutRank } from "#src/assets/index.tsx";
import { cn } from "#src/lib/cn.ts";
import { RankDisplay } from "#src/domain/rank-display.tsx";

export type RankLockupProps = {
  rank: ScoutRank;
  division?: string;
  leaguePoints?: number;
  /** The second line: another queue, a peak, a trend. */
  secondary?: ReactNode;
  /** Crest width in pixels. */
  size?: number;
  className?: string;
};

/**
 * A crest with the rank and LP in one line and a quieter line beneath, as the
 * lead of a player's hero panel. It is `RankDisplay` at hero scale.
 */
export function RankLockup({
  rank,
  division,
  leaguePoints,
  secondary,
  size = 88,
  className,
}: RankLockupProps) {
  return (
    <RankDisplay
      rank={rank}
      size={size}
      className={cn("scout-rank-lockup", className)}
      {...(division === undefined ? {} : { division })}
      {...(leaguePoints === undefined ? {} : { leaguePoints })}
      {...(secondary === undefined ? {} : { detail: secondary })}
    />
  );
}
