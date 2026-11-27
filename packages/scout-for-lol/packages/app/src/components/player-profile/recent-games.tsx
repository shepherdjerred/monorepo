import { chipVariants } from "@scout-for-lol/design-system/components/surfaces/chip";
import { Panel } from "@scout-for-lol/design-system/components/surfaces/panel";
import { GameSentenceRow } from "@scout-for-lol/design-system/domain/rows/game-sentence-row";
import { useState, type ReactNode } from "react";
import {
  SECTION_HEADING,
  TEXT_LINK,
} from "#src/components/friendly-classes.ts";
import { useSpaLink } from "#src/hooks/use-spa-link.ts";
import { FEED_PREVIEW, type FeedRow } from "#src/lib/player/player-feed.ts";

function GameLink(props: { playerId: number; row: FeedRow }) {
  const { row } = props;
  const link = useSpaLink(
    `/players/${props.playerId.toString()}/matches/${row.matchId}`,
  );
  return (
    <GameSentenceRow
      result={row.result}
      champion={row.championId}
      kda={row.kda}
      {...(row.lpChange === undefined ? {} : { lpChange: row.lpChange })}
      {...(row.detail === undefined ? {} : { detail: row.detail })}
      {...(row.highlight === undefined ? {} : { highlight: row.highlight })}
      when={row.when}
      href={link.href}
      onClick={link.onClick}
    />
  );
}

/** The newest games, one sentence each, under the controls that choose them. */
export function RecentGames(props: {
  playerId: number;
  rows: readonly FeedRow[];
  controls: ReactNode;
  /** The games could not be read; the controls stay. */
  failed: { onRetry: () => void } | undefined;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? props.rows : props.rows.slice(0, FEED_PREVIEW);
  return (
    <Panel asChild>
      <section aria-labelledby="recent-h">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <h2 id="recent-h" className={SECTION_HEADING}>
            Recent games
          </h2>
          {props.controls}
        </div>
        <RecentBody
          playerId={props.playerId}
          rows={props.rows}
          shown={shown}
          failed={props.failed}
          expanded={all}
          onExpand={() => {
            setAll(true);
          }}
        />
      </section>
    </Panel>
  );
}

function RecentBody(props: {
  playerId: number;
  rows: readonly FeedRow[];
  shown: readonly FeedRow[];
  failed: { onRetry: () => void } | undefined;
  expanded: boolean;
  onExpand: () => void;
}) {
  if (props.failed !== undefined) {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <p className="m-0 text-scout-subtle">
          Recent games could not be loaded.
        </p>
        <button
          type="button"
          className={chipVariants()}
          onClick={props.failed.onRetry}
        >
          Retry
        </button>
      </div>
    );
  }
  if (props.rows.length === 0) {
    return <p className="m-0 mt-4 text-scout-subtle">No games</p>;
  }
  return (
    <>
      <ol className="m-0 mt-3.5 grid list-none gap-0 p-0 sm:-mx-3.5">
        {props.shown.map((row) => (
          <li key={row.matchId}>
            <GameLink playerId={props.playerId} row={row} />
          </li>
        ))}
      </ol>
      {props.expanded || props.rows.length <= FEED_PREVIEW ? null : (
        <button
          type="button"
          className={`${TEXT_LINK} mt-3.5 inline-flex min-h-11 items-center`}
          onClick={props.onExpand}
        >
          See all games
        </button>
      )}
    </>
  );
}
