import { RankCrest, type ScoutRank } from "#src/assets/index.tsx";
import { cn } from "#src/lib/cn.ts";
import { NameText } from "#src/domain/profile/name-text.tsx";
import { PersonInitial } from "#src/domain/profile/person-initial.tsx";

export type FriendRowRank = {
  rank: ScoutRank;
  division?: string;
  leaguePoints?: number;
};

export type FriendRowProps = {
  name: string;
  /** Makes the whole row a link. */
  href?: string;
  /** The viewer: the initial and the row take the brand colour. */
  you?: boolean;
  /** Ladder place. Switches to the ladder layout: place first, crest last. */
  place?: number;
  /** Left out for someone with no rank to show. */
  rank?: FriendRowRank;
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

/**
 * A person in a list of friends: initial, name, the latest game as a sentence
 * and their rank. Players lists use the default layout; a server's ranking
 * passes `place`.
 */
export function FriendRow({
  name,
  href,
  you = false,
  place,
  rank,
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
      <span className="scout-friend-row__rank">
        {rank === undefined ? (
          <span className="scout-friend-row__unranked">Unranked</span>
        ) : (
          <>
            <RankCrest rank={rank.rank} width={ladder ? 46 : 44} alt="" />
            <span>
              <b>{rankLine(rank)}</b>
              {rank.leaguePoints === undefined ? null : (
                <span>{rank.leaguePoints} LP</span>
              )}
            </span>
          </>
        )}
      </span>
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
    <a {...common} href={href}>
      {content}
    </a>
  );
}
