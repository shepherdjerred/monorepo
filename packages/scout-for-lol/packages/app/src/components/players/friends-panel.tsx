import { Panel } from "@scout-for-lol/design-system/components/surfaces/panel";
import { FriendRow } from "@scout-for-lol/design-system/domain/rows/friend-row";
import { useState, type ReactNode } from "react";
import {
  SECTION_HEADING,
  TEXT_LINK,
} from "#src/components/friendly-classes.ts";
import { useSpaLink } from "#src/hooks/use-spa-link.ts";
import {
  FRIENDS_PREVIEW,
  latestLine,
  rowRank,
  type RosterPlayer,
} from "#src/lib/players/roster-page.ts";

function RosterRow(props: { player: RosterPlayer; nowMs: number }) {
  const { player } = props;
  const link = useSpaLink(`/players/${player.playerId.toString()}`);
  const rank = rowRank(player);
  const latest = latestLine(player, props.nowMs);
  return (
    <FriendRow
      name={player.alias}
      href={link.href}
      onClick={link.onClick}
      you={player.isYou}
      live={player.live !== null}
      {...(rank === undefined ? {} : { rank })}
      {...(latest === undefined ? {} : { latest })}
    />
  );
}

/** A list of people with their latest game and rank; long lists open with "See all". */
export function PlayersPanel(props: {
  id: string;
  title: string;
  players: readonly RosterPlayer[];
  nowMs: number;
  controls?: ReactNode;
  /** What an empty list says. */
  empty: string;
  /** Show every row at once, with no "See all". */
  everyone?: boolean;
}) {
  const [all, setAll] = useState(false);
  const everyone = props.everyone === true || all;
  const shown = everyone
    ? props.players
    : props.players.slice(0, FRIENDS_PREVIEW);
  return (
    <Panel asChild>
      <section aria-labelledby={props.id}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <h2 id={props.id} className={SECTION_HEADING}>
            {props.title}
          </h2>
          {props.controls}
        </div>
        {props.players.length === 0 ? (
          <p className="m-0 mt-4 text-scout-subtle">{props.empty}</p>
        ) : (
          <ul className="m-0 mt-3.5 grid list-none gap-0.5 p-0 sm:-mx-3.5">
            {shown.map((player) => (
              <li key={player.playerId}>
                <RosterRow player={player} nowMs={props.nowMs} />
              </li>
            ))}
          </ul>
        )}
        {everyone || props.players.length <= FRIENDS_PREVIEW ? null : (
          <button
            type="button"
            className={`${TEXT_LINK} mt-3.5 inline-flex min-h-11 items-center`}
            onClick={() => {
              setAll(true);
            }}
          >
            See all {props.players.length.toString()}
          </button>
        )}
      </section>
    </Panel>
  );
}
