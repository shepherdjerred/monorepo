import { Panel } from "@scout-for-lol/design-system/components/surfaces/panel";
import { RankLockup } from "@scout-for-lol/design-system/domain/profile/rank-lockup";
import { Link } from "react-router";
import {
  SECTION_HEADING,
  TEXT_LINK,
} from "#src/components/friendly-classes.ts";
import {
  rowRank,
  youLine,
  type RosterPlayer,
} from "#src/lib/players/roster-page.ts";
import { rankName } from "#src/lib/player/rank-parts.ts";

/** The viewer: their rank and how the newest games went, with a way to their page. */
export function YouPanel(props: { player: RosterPlayer }) {
  const { player } = props;
  const rank = rowRank(player);
  const line = youLine(player);
  const flex = player.rank.solo === null ? null : player.rank.flex;
  return (
    <Panel asChild>
      <section aria-labelledby="you-h">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 id="you-h" className={SECTION_HEADING}>
            You
          </h2>
          <Link
            to={`/players/${player.playerId.toString()}`}
            className={`${TEXT_LINK} inline-flex min-h-11 items-center`}
          >
            Open your profile
          </Link>
        </div>
        <div className="mt-2.5">
          {rank === undefined ? (
            <p className="m-0 font-display text-2xl font-bold">
              {player.alias}
            </p>
          ) : (
            <RankLockup
              rank={rank.rank}
              leaguePoints={rank.leaguePoints}
              {...(rank.division === undefined
                ? {}
                : { division: rank.division })}
              secondary={
                flex === null
                  ? player.alias
                  : `${player.alias}, ${rankName(flex)} in Flex`
              }
            />
          )}
        </div>
        {line === undefined ? null : (
          <p className="m-0 mt-2 max-w-[58ch] text-pretty text-scout-subtle">
            {line}
          </p>
        )}
      </section>
    </Panel>
  );
}
