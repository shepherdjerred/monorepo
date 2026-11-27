import { Panel } from "@scout-for-lol/design-system/components/surfaces/panel";
import { FriendRow } from "@scout-for-lol/design-system/domain/rows/friend-row";
import type { ReactNode } from "react";
import { useSpaLink } from "#src/hooks/use-spa-link.ts";
import {
  formText,
  type ComparisonRow,
} from "#src/lib/champions/champion-pages.ts";

/** Who is best on the champion: everyone with enough games, best win rate first. */
export function RankingPanel(props: {
  championName: string;
  rows: readonly ComparisonRow[];
  controls: ReactNode;
}) {
  return (
    <Panel asChild>
      <section aria-labelledby="ranking-h">
        <h2
          id="ranking-h"
          className="m-0 font-display text-2xl leading-tight font-bold"
        >
          Who&apos;s best on {props.championName}
        </h2>
        <div className="mt-3">{props.controls}</div>
        <ol className="m-0 mt-3.5 grid list-none gap-0.5 p-0 sm:-mx-3.5">
          {props.rows.map((row, index) => (
            <li key={`${row.guild.guildId}:${row.playerId.toString()}`}>
              <RankingRow row={row} place={index + 1} />
            </li>
          ))}
        </ol>
      </section>
    </Panel>
  );
}

function RankingRow(props: { row: ComparisonRow; place: number }) {
  const { row } = props;
  const link = useSpaLink(`/players/${row.playerId.toString()}`);
  return (
    <FriendRow
      name={row.alias}
      href={link.href}
      onClick={link.onClick}
      place={props.place}
      you={row.viewerLinked}
      latest={row.guild.name}
      record={{
        games: row.games,
        winRate: row.winRate * 100,
        form: formText(row),
      }}
    />
  );
}
