import { RankCrest, type ScoutRank } from "#src/assets/index.tsx";
import { cn } from "#src/lib/cn.ts";

export function RankDisplay(props: {
  rank: ScoutRank;
  division?: string;
  leaguePoints?: number;
  compact?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("scout-rank-display", props.className)}>
      <RankCrest rank={props.rank} width={props.compact === true ? 32 : 48} />
      <span>
        <strong>
          {props.rank}
          {props.division === undefined ? "" : ` ${props.division}`}
        </strong>
        {props.leaguePoints === undefined ? null : (
          <small>{props.leaguePoints} LP</small>
        )}
      </span>
    </span>
  );
}
