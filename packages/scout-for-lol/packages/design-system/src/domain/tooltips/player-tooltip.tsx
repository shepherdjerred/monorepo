import type { ReactNode } from "react";
import { RankCrest, type ScoutRank } from "#src/assets/index.tsx";
import {
  TooltipBody,
  TooltipFoot,
  TooltipHeader,
  TooltipScoutBlock,
  type TooltipLink,
} from "#src/domain/tooltips/entity-tooltip-parts.tsx";

export type PlayerTooltipProps = {
  name: string;
  /** The group or server the player is in. */
  group?: string | undefined;
  rank?:
    | {
        tier: ScoutRank;
        division?: string | undefined;
        leaguePoints?: number | undefined;
        /** "Solo/Duo" */
        queue: string;
      }
    | undefined;
  /** The latest game as a sentence: "Won" and "as Jinx, 10/3/9, 2 hours ago". */
  latestGame?: { result: string; detail: string } | undefined;
  /** What Scout knows about the reader and this player, such as games together. */
  scout?: ReactNode | undefined;
  profileHref?: string | undefined;
  compareHref?: string | undefined;
};

/**
 * The tooltip for a player's initial or name: rank and latest game, then the
 * reader's own history with them, then their profile and Compare.
 */
export function PlayerTooltip(props: PlayerTooltipProps) {
  const links: TooltipLink[] = [];
  if (props.profileHref !== undefined) {
    links.push({ href: props.profileHref, label: `Open ${props.name}` });
  }
  if (props.compareHref !== undefined) {
    links.push({ href: props.compareHref, label: "Compare with you" });
  }
  const { rank } = props;
  return (
    <>
      <TooltipHeader
        icon={
          <span className="scout-tooltip__monogram" aria-hidden="true">
            {props.name.slice(0, 1).toUpperCase()}
          </span>
        }
        name={props.name}
        kind={props.group}
      />
      <TooltipBody>
        {rank === undefined ? null : (
          <p className="scout-tooltip__rank">
            <RankCrest rank={rank.tier} width={56} height={56} alt="" />
            <span>
              <b>
                {rank.tier}
                {rank.division === undefined ? "" : ` ${rank.division}`}
                {rank.leaguePoints === undefined
                  ? ""
                  : `, ${String(rank.leaguePoints)} LP`}
              </b>
              <span className="scout-tooltip__quiet">{rank.queue}</span>
            </span>
          </p>
        )}
        {props.latestGame === undefined ? null : (
          <p className="scout-tooltip__desc">
            <b>{props.latestGame.result}</b> {props.latestGame.detail}
          </p>
        )}
        {props.scout === undefined ? null : (
          <TooltipScoutBlock>{props.scout}</TooltipScoutBlock>
        )}
      </TooltipBody>
      <TooltipFoot links={links} />
    </>
  );
}
