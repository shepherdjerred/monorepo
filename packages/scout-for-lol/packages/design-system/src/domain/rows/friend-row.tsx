import type { MouseEventHandler } from "react";
import { RankCrest, type ScoutRank } from "#src/assets/index.tsx";
import { cn } from "#src/lib/cn.ts";
import { NameText } from "#src/domain/profile/name-text.tsx";
import { PersonInitial } from "#src/domain/profile/person-initial.tsx";
import { WinRateBar } from "#src/domain/profile/win-rate-bar.tsx";
import { gamesLabel } from "./format.ts";

export type FriendRowRank = {
  rank: ScoutRank;
  division?: string;
  leaguePoints?: number;
};

/** How someone does on one thing, such as a champion: games, form and win rate. */
export type FriendRowRecord = {
  games: number;
  /** Win rate in percent, 0 to 100. */
  winRate: number;
  /** A fact about the newest games: "Won 7 of the last 10". */
  form?: string;
};

export type FriendRowProps = {
  name: string;
  /** Makes the whole row a link. */
  href?: string;
  /** For a link a router takes over: the row stays an anchor with its `href`. */
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  /** The viewer: the initial and the row take the brand colour. */
  you?: boolean;
  /** Ladder place. Switches to the ladder layout: place first, crest last. */
  place?: number;
  /** Left out for someone with no rank to show. */
  rank?: FriendRowRank;
  /** Games and win rate in place of a rank, as in a champion's ranking. */
  record?: FriendRowRecord;
  /** The latest game as the end of a sentence, such as "Lost as Thresh, 2 hours ago". */
  latest?: string;
  /** In a game now: a live dot on the initial and "In a game now" leading `latest`. */
  live?: boolean;
  className?: string;
};

/** The line under the name: "In a game now, as Ahri" or the latest game. */
export function latestLine(props: {
  latest: string | undefined;
  live: boolean;
}): string | undefined {
  if (!props.live) return props.latest;
  return props.latest === undefined
    ? "In a game now"
    : `In a game now, ${props.latest}`;
}

function rankLine(rank: FriendRowRank): string {
  return rank.division === undefined
    ? rank.rank
    : `${rank.rank} ${rank.division}`;
}

function RankCell(props: { rank: FriendRowRank | undefined; ladder: boolean }) {
  const { rank } = props;
  return (
    <span className="scout-friend-row__rank">
      {rank === undefined ? (
        <span className="scout-friend-row__unranked">Unranked</span>
      ) : (
        <>
          <RankCrest rank={rank.rank} width={props.ladder ? 46 : 44} alt="" />
          <span>
            <b>{rankLine(rank)}</b>
            {rank.leaguePoints === undefined ? null : (
              <span>{rank.leaguePoints} LP</span>
            )}
          </span>
        </>
      )}
    </span>
  );
}

function RecordCell(props: { record: FriendRowRecord; you: boolean }) {
  const { record } = props;
  return (
    <span className="scout-friend-row__record">
      <span className="scout-friend-row__games">
        {gamesLabel(record.games)}
        {record.form === undefined ? null : <span>{record.form}</span>}
      </span>
      <WinRateBar value={record.winRate} you={props.you} />
    </span>
  );
}

/**
 * A person in a list of friends: initial, name, the latest game as a sentence
 * and their rank. Players lists use the default layout; a server's ranking
 * passes `place`.
 */
export function FriendRow({
  name,
  href,
  onClick,
  you = false,
  place,
  rank,
  record,
  latest,
  live = false,
  className,
}: FriendRowProps) {
  const line = latestLine({ latest, live });
  const ladder = place !== undefined;
  const content = (
    <>
      {ladder ? <span className="scout-friend-row__place">{place}</span> : null}
      <PersonInitial name={name} you={you} live={live} />
      <span className="scout-friend-row__id">
        <span className="scout-friend-row__name">
          <b>
            <NameText>{name}</NameText>
          </b>
          {you ? <span className="scout-friend-row__you">You</span> : null}
        </span>
        {line === undefined ? null : (
          <span
            className="scout-friend-row__latest"
            data-live={live ? "true" : undefined}
          >
            {line}
          </span>
        )}
      </span>
      {record === undefined ? (
        <RankCell rank={rank} ladder={ladder} />
      ) : (
        <RecordCell record={record} you={you} />
      )}
    </>
  );
  const classes = cn("scout-friend-row", className);
  const common = {
    className: classes,
    "data-layout": ladder ? "ladder" : "list",
    "data-you": you ? "true" : undefined,
  } as const;
  return href === undefined ? (
    <div {...common}>{content}</div>
  ) : (
    <a {...common} href={href} onClick={onClick}>
      {content}
    </a>
  );
}
