import { Panel } from "@scout-for-lol/design-system/components/surfaces/panel";
import { RankLockup } from "@scout-for-lol/design-system/domain/profile/rank-lockup";
import { Link } from "react-router";
import { LiveFriendLine } from "#src/components/live/live-friend-line.tsx";
import { TEXT_LINK } from "#src/components/live/live-classes.ts";
import {
  championName,
  laneShort,
  liveFriends,
  rankCrestTier,
  rankDivision,
  rankLabel,
  rankOf,
  laneOf,
  type LiveGameData,
  type LiveParticipant,
} from "#src/lib/live/live-game.ts";

function friendOf(participant: LiveParticipant) {
  if (participant.friend === null) {
    throw new Error("A lobby row without a friend has no friend to show");
  }
  return participant.friend;
}

function profilePath(participant: LiveParticipant): string {
  return `/players/${friendOf(participant).playerId.toString()}`;
}

function rankProps(participant: LiveParticipant) {
  const rank = rankOf(participant);
  if (rank === null) return {};
  const division = rankDivision(rank);
  return {
    rank: {
      rank: rankCrestTier(rank),
      ...(division === undefined ? {} : { division }),
      leaguePoints: rank.lp,
    },
  };
}

/** One friend in the game: their profile and the rank they hold. */
function OneFriend(props: { participant: LiveParticipant }) {
  const { participant } = props;
  const rank = rankProps(participant).rank;
  return (
    <Panel asChild>
      <section aria-labelledby="friend-h">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <h2
            id="friend-h"
            className="m-0 font-display text-2xl leading-tight font-bold"
          >
            {`${friendOf(participant).alias} on ${championName(participant.championId)}`}
          </h2>
          <Link to={profilePath(participant)} className={TEXT_LINK}>
            See profile
          </Link>
        </div>
        {rank === undefined ? null : (
          <RankLockup
            className="mt-5"
            size={64}
            rank={rank.rank}
            {...(rank.division === undefined
              ? {}
              : { division: rank.division })}
            leaguePoints={rank.leaguePoints}
          />
        )}
      </section>
    </Panel>
  );
}

function crestProps(participant: LiveParticipant) {
  const rank = rankOf(participant);
  return rank === null
    ? {}
    : { rank: { crest: rankCrestTier(rank), label: rankLabel(rank) } };
}

function friendLatest(participant: LiveParticipant): string {
  const champion = championName(participant.championId);
  const lane = laneOf(participant);
  return lane === null
    ? `as ${champion}`
    : `as ${champion}, ${laneShort(lane)}`;
}

function SeveralFriends(props: { friends: readonly LiveParticipant[] }) {
  return (
    <Panel asChild>
      <section aria-labelledby="friends-h">
        <h2
          id="friends-h"
          className="m-0 font-display text-2xl leading-tight font-bold"
        >
          Friends in this game
        </h2>
        <ul className="m-0 mt-3.5 grid list-none gap-0.5 p-0 sm:-mx-3.5">
          {props.friends.map((participant) => (
            <li key={friendOf(participant).playerId}>
              <LiveFriendLine
                to={profilePath(participant)}
                name={friendOf(participant).alias}
                line={`In a game now, ${friendLatest(participant)}`}
                {...crestProps(participant)}
              />
            </li>
          ))}
        </ul>
      </section>
    </Panel>
  );
}

/** The friends in the game: their rank, and the way to their profile. */
export function LiveFriendsPanel(props: { game: LiveGameData }) {
  const friends = liveFriends(props.game);
  const [only] = friends;
  if (only === undefined) return null;
  return friends.length === 1 ? (
    <OneFriend participant={only} />
  ) : (
    <SeveralFriends friends={friends} />
  );
}
