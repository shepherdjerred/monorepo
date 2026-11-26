import { getBrowserChampionName } from "@scout-for-lol/data/browser-assets";
import { LaneIcon } from "#src/assets/index.tsx";
import { cn } from "#src/lib/cn.ts";
import { ChampionFace } from "#src/domain/profile/champion-face.tsx";
import { formatPercent } from "#src/domain/profile/win-rate-bar.tsx";
import { gamesLabel } from "./format.ts";

export type ChampionCardLane = {
  /** The lane's name on the card: "Bot". */
  label: string;
  /** The lane icon key: "top", "jungle", "middle", "adc", "support". */
  icon: string;
};

export type ChampionCardProps = {
  champion: string | number;
  href: string;
  lane?: ChampionCardLane;
  /** Win rate in percent, and the games behind it. */
  winRate: number;
  games: number;
  /** Win rate in lane in percent, and the games behind it. */
  laneWinRate?: number;
  laneGames?: number;
  /** "S tier". */
  tier?: string;
  className?: string;
};

/** A champion on the index: face, name, lane, win rate and the games behind it. */
export function ChampionCard({
  champion,
  href,
  lane,
  winRate,
  games,
  laneWinRate,
  laneGames,
  tier,
  className,
}: ChampionCardProps) {
  return (
    <a className={cn("scout-champion-card", className)} href={href}>
      <ChampionFace champion={champion} size={72} alt="" />
      <b className="scout-champion-card__name">
        {getBrowserChampionName(champion)}
      </b>
      {lane === undefined ? null : (
        <span className="scout-champion-card__lane">
          <LaneIcon lane={lane.icon} alt="" />
          {lane.label}
        </span>
      )}
      <span className="scout-champion-card__win">
        <b>{formatPercent(winRate)}</b> wins
      </span>
      <span className="scout-champion-card__from">
        from {gamesLabel(games)}
      </span>
      {laneWinRate === undefined ? null : (
        <span className="scout-champion-card__from scout-champion-card__lane-line">
          <span>Wins lane {formatPercent(laneWinRate)}</span>
          {laneGames === undefined ? null : (
            <span>from {laneGames.toLocaleString("en-US")}</span>
          )}
        </span>
      )}
      {tier === undefined ? null : (
        <span className="scout-champion-card__tier-slot">
          <span className="scout-champion-card__tier">{tier}</span>
        </span>
      )}
    </a>
  );
}
