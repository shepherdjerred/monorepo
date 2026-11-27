import type { MouseEventHandler } from "react";
import { getBrowserChampionName } from "@scout-for-lol/data/browser-assets";
import { cn } from "#src/lib/cn.ts";
import { ChampionFace } from "#src/domain/profile/champion-face.tsx";
import { PersonInitial } from "#src/domain/profile/person-initial.tsx";
import type { GameResult } from "#src/domain/profile/result-strip.tsx";
import { Spark } from "./spark.tsx";

export type Kda = { kills: number; deaths: number; assists: number };

export type GameSentenceRowProps = {
  result: GameResult;
  champion: string | number;
  /**
   * Someone else's game, as in a feed of friends: their name leads the
   * sentence and their initial wears the champion as a badge. Without it the
   * game is the viewer's own and the champion's face carries the result.
   */
  person?: string;
  /** Closes the sentence after the champion: "with you". */
  suffix?: string;
  kda?: Kda;
  /** LP gained (positive) or lost (negative) in the game. */
  lpChange?: number;
  /** "2 hours ago". */
  when?: string;
  /** A quieter second line, such as the queue. */
  detail?: string;
  /** A highlight worth a mark, such as "Quadra kill". */
  highlight?: string;
  href?: string;
  /** For a link a router takes over: the row stays an anchor with its `href`. */
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  className?: string;
};

/** "+21 LP" and "−18 LP", with a true minus sign. */
export function formatLpChange(value: number): string {
  if (value === 0) return "0 LP";
  return `${value > 0 ? "+" : "−"}${String(Math.abs(value))} LP`;
}

/** The bold lead and the rest of the sentence. */
export function gameSentence(props: {
  result: GameResult;
  championName: string;
  person?: string;
  suffix?: string;
  kda?: Kda;
  lpChange?: number;
}): { lead: string; rest: string } {
  const verb = props.result === "win" ? "won" : "lost";
  const kda =
    props.kda === undefined
      ? ""
      : `, ${String(props.kda.kills)}/${String(props.kda.deaths)}/${String(props.kda.assists)}`;
  const lp =
    props.lpChange === undefined ? "" : `, ${formatLpChange(props.lpChange)}`;
  if (props.person !== undefined) {
    const suffix = props.suffix === undefined ? "" : ` ${props.suffix}`;
    return {
      lead: props.person,
      rest: ` ${verb} as ${props.championName}${suffix}${kda}${lp}`,
    };
  }
  return {
    lead: props.result === "win" ? "Won" : "Lost",
    rest: ` as ${props.championName}${kda}${lp}`,
  };
}

/**
 * One game as a plain sentence: "Won as Ahri, 9/2/11, +21 LP", or
 * "RiverQuartz won as Jinx with you, 10/3/9" in a feed of friends. The time
 * sits at the end.
 */
export function GameSentenceRow({
  result,
  champion,
  person,
  suffix,
  kda,
  lpChange,
  when,
  detail,
  highlight,
  href,
  onClick,
  className,
}: GameSentenceRowProps) {
  const { lead, rest } = gameSentence({
    result,
    championName: getBrowserChampionName(champion),
    ...(person === undefined ? {} : { person }),
    ...(suffix === undefined ? {} : { suffix }),
    ...(kda === undefined ? {} : { kda }),
    ...(lpChange === undefined ? {} : { lpChange }),
  });
  const content = (
    <>
      {person === undefined ? (
        <ChampionFace champion={champion} result={result} alt="" />
      ) : (
        <PersonInitial name={person} champion={champion} />
      )}
      <span className="scout-game-row__text">
        <span className="scout-game-row__line">
          <b
            className="scout-game-row__lead"
            {...(person === undefined ? {} : { title: lead })}
          >
            {lead}
          </b>
          {rest}
          {highlight === undefined ? null : (
            <span className="scout-game-row__spark" title={highlight}>
              <Spark />
              <span className="scout-sr-only">{highlight}</span>
            </span>
          )}
        </span>
        {detail === undefined ? null : (
          <span className="scout-game-row__detail">{detail}</span>
        )}
      </span>
      {when === undefined ? null : (
        <span className="scout-game-row__when">{when}</span>
      )}
    </>
  );
  const classes = cn("scout-game-row", className);
  return href === undefined ? (
    <div className={classes}>{content}</div>
  ) : (
    <a className={classes} href={href} onClick={onClick}>
      {content}
    </a>
  );
}
