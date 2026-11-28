import type { ReactNode } from "react";
import { RankCrest, type ScoutRank } from "#src/assets/index.tsx";
import { cn } from "#src/lib/cn.ts";

export function RankDisplay(props: {
  rank: ScoutRank;
  division?: string;
  leaguePoints?: number;
  compact?: boolean;
  /** Crest width in pixels; overrides `compact`. */
  size?: number;
  /** A further line under the rank, such as the other queue. */
  detail?: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("scout-rank-display", props.className)}>
      <RankCrest
        rank={props.rank}
        width={props.size ?? (props.compact === true ? 32 : 48)}
      />
      <span>
        <strong>
          {props.rank}
          {props.division === undefined ? "" : ` ${props.division}`}
        </strong>
        {props.leaguePoints === undefined ? null : (
          <small>{props.leaguePoints} LP</small>
        )}
        {props.detail === undefined ? null : (
          <small className="scout-rank-display__detail">{props.detail}</small>
        )}
      </span>
    </span>
  );
}
